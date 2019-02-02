import Uri from 'vscode-uri'
import { IConnection, TextDocuments } from 'vscode-languageserver'
import { DiagnosticSeverity } from "vscode-languageserver-types"
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'

const rhoTmpPath = `${os.tmpdir()}/vscode-rholang`
const rhoTmpName = `rholang-vscode-${tmpFileName().substr(0, 16)}`
const workingFolder = `${rhoTmpPath}/${rhoTmpName}`

function tmpFileName() {
  const hash = crypto.createHash('sha256')
  hash.write(Math.random().toString())
  hash.end()
  return hash.read().toString('hex')
}

function regexec(regex, str) {
  let r, result, p
  r = new RegExp(regex)
  result = []
  for (;;) {
    if (p = r.exec(str)) { result.push(p) } else break
  }
  return result[0]
}

export class RholangServer {
  protected workspaceRoot: Uri | undefined
  protected readonly documents = new TextDocuments()
  protected readonly pendingValidationRequests = new Map<string, number>()
  private _uri: string | undefined
  private _settings: {
    disableLanguageServer: boolean
    showAllOutput: boolean
  }
  isReady = false

  constructor(
    protected readonly connection: IConnection,
    readonly log = (msg: any) => connection.console.log(msg)
  ) {
    this.documents.listen(this.connection)

    const stopRNodeProcess = () => spawn('docker', ['stop', rhoTmpName], { detached: true, stdio: 'ignore' })
    const startRNodeProcess = () => {
      log(`Temp folder: ${workingFolder}`)

      // Start RNode (standalone) process used by the server
      const rhovm = this.startRNode()

      // Try to stop RNode on server exit
      // docker stop (docker ps -a | grep rholang-vscode | awk 'match($0, /^([[:digit:]a-f]+).+rholang-vscode-[[:digit:]a-f]+/, xs) { print xs[1] }')
      process.on('exit', () => {
        stopRNodeProcess()
      })

      this.connection.onInitialize(params => {
        if (params.rootPath) {
          this.workspaceRoot = Uri.file(params.rootPath)
        } else if (params.rootUri) {
          this.workspaceRoot = Uri.parse(params.rootUri)
        }
        this.log(`Process PID: ${rhovm.pid}`)
        return {
          capabilities: {
            textDocumentSync: this.documents.syncKind,
            hoverProvider: false,
            documentSymbolProvider: false,
            documentRangeFormattingProvider: false,
          }
        }
      })
    }

    // Evaluate the code on save document
    this.connection.onDidSaveTextDocument(params => {
      const uri = params.textDocument.uri
      this.evalCode(uri)
    })

    // Settings
    this.connection.onDidChangeConfiguration((change) => {
      this.log('Settings: ' + JSON.stringify(change.settings, null, 2))
      this._settings = change.settings.rholang || {}
      if (!this._settings.disableLanguageServer) {
      log('Rholang Language Server (enabled)')
      startRNodeProcess()
      } else {
        log('Rholang Language Server (disabled)')
        stopRNodeProcess()
      }
    })

  }

  start() {
    this.connection.listen()
  }

  sendErrors(uri, ...msgs) {
    const diagnostics = msgs.map(x => ({
      severity: DiagnosticSeverity.Error,
      ...x
    }))
    this._settings.showAllOutput &&
      this.log('Diagnostics: ' + JSON.stringify(diagnostics, null, 2))
    this.connection.sendDiagnostics({ uri, diagnostics })
  }

  sendClear(uri) {
    const diagnostics = []
    this.connection.sendDiagnostics({ uri, diagnostics })
  }

  startRNode() {
    // Create working folder, as current user (Docker run as root)
    if (!fs.existsSync(workingFolder)) fs.mkdirSync(workingFolder)

    // Start RNode (standalone) process used by the server
    const volume = `${workingFolder}:/vscode`
    const vm = spawn('docker', ['run', '-i', '--rm', '--name', rhoTmpName, '-v', volume, 'rchain/rnode:master', 'run', '-s', '-n'])

    vm.stderr.on('data', data => {
      const result = `${data}`

      // Display error on last evaluated editor document
      // - until all errors will be returned to the caller
      // - https://github.com/rchain/rchain/pull/2143
      // Sample: Syntax Error, trying to recover and continue parse... for input symbol "" spanning from unknown:15/24(460) to unknown:15/25(461)
      const syntaxErrorRegex = /Syntax Error[\s\S]+spanning from unknown:(\d+)\/(\d+)\(\d+\) to unknown:(\d+)\/(\d+)\(\d+\)/g
      const syntaxError = regexec(syntaxErrorRegex, result)
      if (syntaxError) {
        const [message, ...ranges] = syntaxError
        const [sl, sc, el, ec] = ranges.map(x => parseInt(x) - 1)
        const range = {
          start: { line: sl, character: sc },
          end: { line: el, character: ec },
        }
        this.sendErrors(this._uri, {range, message})
        this.log('')
        this.log(`Error: ${message}`)
      }

      const knownMsg = syntaxError
      if (this._settings.showAllOutput && !knownMsg && result.trim() != '') {
        this.log('')
        this.log(`STDERR:\n${result}`)
      }
    })

    let isStarted = false
    // TODO: only temp. to get better output
    let isReadyOutput = false

    // RNode stdout
    vm.stdout.on('data', data => {
      const result = `${data}`

      // Display output from callee rnode
      if (this._settings.showAllOutput) {
        this.log(result.replace(/[\n\r]*$/, ''))
      } else if (!this.isReady) {
        if (!isStarted) {
          process.stdout.write('Rholang VM starting ')
          isStarted = true
        }
        // Display progress as dots
        process.stdout.write('.')
      } else if (this.isReady && isReadyOutput) {
        this.log(result.replace(/[\n\r]*$/, ''))
      }

      // Check for log message that node is ready
      // Sample: INFO  c.r.c.util.comm.CasperPacketHandler$ - Making a transition to ApprovedBlockRecievedHandler state.
      const ready = regexec(/Making a transition to ApprovedBlockRecievedHandler state/g, result)
      if (ready) {
        this.connection.window.showInformationMessage('Rholang VM is ready!')
        this.log('')
        this.log('Rholang VM is ready!')
        this.isReady = true
        // Small delay to supress few starting log msgs
        setTimeout(() => isReadyOutput = true, 300)
      }
    })
    return vm
  }

  evalCode(uri: string) {
    // Global uri until caller gets all errors
    this._uri = uri
    const document = this.documents.get(uri)
    const codeString = document.getText()

    // Write code to a file
    const filePath = `${workingFolder}/eval.rho`
    fs.writeFileSync(filePath, codeString, 'utf-8')

    // Start Rholang VM (eval)
    this.log('')
    this.log('Sending code to Rholang VM ...................................................................')

    // Execute code with Docker
    const vm = spawn('docker', ['exec', rhoTmpName, '/opt/docker/bin/rnode', 'eval', `/vscode/eval.rho`])

    vm.stderr.on('data', data => {
      const result = `${data}`
      if (this._settings.showAllOutput && result.trim() != '') {
        this.log('')
        this.log(`STDERR:\n${result}`)
      }
    })

    // Listen for compiler results
    vm.stdout.on('data', data => {
      // Ensure it's string
      const result = `${data}`

      // Evaluating term
      const evalTermRegex = /[\s\S]+(Evaluating:[\n ]+.+)/g
      const evalTerm = regexec(evalTermRegex, result)
      if (evalTerm) {
        const [_, evalMsg] = evalTerm
        this.log('')
        this.log(evalMsg)
      }

      // Deployment cost: CostAccount(39,Cost(1165))
      const costRegex = /Deployment cost: CostAccount\((\d+),Cost\((\d+)\)\)/g
      const cost = regexec(costRegex, result)
      if (cost) {
        const [costMsg, n1, n2] = cost
        this.sendClear(uri)
        this.log('')
        this.log(costMsg)
      }

      // Compile errors

      // Error: coop.rchain.rholang.interpreter.errors$TopLevelFreeVariablesNotAllowedError: Top level free variables are not allowed: tdout at 18:5.
      const compileErrorRegex = /Error: [\s\S]+ (\d+):(\d+)\./g
      const compileError = regexec(compileErrorRegex, result)
      if (compileError) {
        const [message, ...ranges] = compileError
        const [sl, sc] = ranges.map(x => parseInt(x) - 1)
        const range = {
          start: { line: sl, character: sc },
          end: { line: sl, character: sc },
        }
        this.sendErrors(uri, {range, message})
        this.log('')
        this.log(message)
      }

      // Error: coop.rchain.rholang.interpreter.errors$UnexpectedProcContext: Name variable: x at 17:5 used in process context at 17:17
      // Error: coop.rchain.rholang.interpreter.errors$UnexpectedNameContext: Proc variable: x at 19:6 used in Name context at 19:19
      const procNameErrorRegex = /Error: [\s\S]+ (\d+):(\d+) used in \w+ context at (\d+):(\d+)/g
      const procNameError = regexec(procNameErrorRegex, result)
      if (procNameError) {
        const [message, ...ranges] = procNameError
        const [sl1, sc1, sl2, sc2] = ranges.map(x => parseInt(x) - 1)
        // Make range with the same start/end
        const r = (line, character, msg) => ({ range: { start: { line, character }, end: { line, character }, }, message: msg })
        const msgs = [r(sl1, sc1, message), r(sl2, sc2, message)]
        this.sendErrors(uri, ...msgs)
        this.log('')
        this.log(message)
      }

      const knownMsg = evalTerm || cost || compileError || procNameError
      if (this._settings.showAllOutput && !knownMsg && result.trim() != '') {
        this.log('')
        this.log(`STDOUT:\n${result}`)
      }

    })
  }

}
