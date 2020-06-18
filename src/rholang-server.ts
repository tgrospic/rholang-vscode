import Uri from 'vscode-uri'
import { IConnection, TextDocuments } from 'vscode-languageserver'
import { DiagnosticSeverity } from "vscode-languageserver-types"
import { spawn, ChildProcess } from 'child_process'
import * as R from 'ramda'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as crypto from 'crypto'
import * as path from 'path'
import * as yaml from 'yaml'
// RNode gRPC
import * as grpc from '@grpc/grpc-js'
import { rnodeProtobuf, EvalRequest, ServerReflectionRequest, ServerReflectionResponse } from '@tgrospic/rnode-grpc-js'
import * as protoSchema from '../rnode-grpc-gen/js/pbjs_generated.json'
import '../rnode-grpc-gen/js/repl_pb'
import '../rnode-grpc-gen/js/reflection_pb'

// Repl gRPC settings
const rnodePort0 = 30400
const rnodeUrl = `localhost:${rnodePort0+2}`
const pbTypes = rnodeProtobuf({ protoSchema })

// Directory paths
const rhoTmpPath = path.join(os.tmpdir(), 'vscode-rholang')
const rhoTmpName = `eval-${tmpFileName().substr(0, 16)}`
const workingFolder = path.join(rhoTmpPath, rhoTmpName)
const dataDir       = path.join(workingFolder, '.rnode')

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

const rnodeGetReplService = (client: grpc.Client) =>
  new Promise((resolve, reject) => {
    // Call RNode reflection method
    const comm = client.makeBidiStreamRequest<ServerReflectionRequest, ServerReflectionResponse>(
      `/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo`,
      R.pipe(pbTypes.ServerReflectionRequest.serialize, Buffer.from),
      pbTypes.ServerReflectionResponse.deserialize,
    )
    // Send request
    comm.write({ listServices: '-' })

    // Receive response
    comm.on('data', (resultMsg: ServerReflectionResponse) => {
      const services = resultMsg.listServicesResponse.serviceList
      const replService = R.find(({name}) => !!name.match(/.Repl$/i), services)
      resolve(replService)
      comm.cancel()
    })
    comm.on('error', reject)
  })

/**
 * Evaluate Rholang code on RNode
 * - handle both versions (namespaces) of API
 */
const rnodeReplEval = async (replReq: EvalRequest, replServiceName: string, client: grpc.Client) =>
  new Promise((resolve, reject) => {
    // Call RNode Eval method
    client.makeUnaryRequest(
      `/${replServiceName}/Eval`,
      R.pipe(pbTypes.EvalRequest.serialize, Buffer.from),
      pbTypes.ReplResponse.deserialize,
      replReq,
      (err, result) => {
        if (err) reject(err)
        else resolve(result)
      }
    )
  })

type Settings = {
  enableLanguageServer: boolean
  rnode               : string
  enableDocker        : boolean
  rnodeDockerImage    : string
  dockerRunOptions    : string
  showAllOutput       : boolean
}

export class RholangServer {
  protected workspaceRoot: Uri | undefined
  protected readonly documents = new TextDocuments()
  protected readonly pendingValidationRequests = new Map<string, number>()
  private _uri: string | undefined
  private _settings: Settings
  isReady = false
  grpcReplServicePath = null
  grpcClient: grpc.Client = null

  constructor(
    protected readonly connection: IConnection,
    readonly log = (msg: any) => connection.console.log(msg)
  ) {
    this.documents.listen(this.connection)

    let rhovm : ChildProcess

    const stopRNodeProcess = useDocker => {
      log(`Stopping RChain Node.`)

      if (rhovm) {
        this.log(`Process PID: ${rhovm.pid}`)

        try {
          if (useDocker) spawn('docker', ['stop', rhoTmpName], { detached: true, stdio: 'ignore' })
          else process.kill(rhovm.pid)
        } catch {}
        rhovm = null
      }
      this.isReady = false
    }

    const startRNodeProcess = () => {
      log(`Temp folder: ${workingFolder}`)

      // Start RNode (standalone) process used by the server
      rhovm = this.startRNode()
      if (rhovm) {
        this.log(`Process PID: ${rhovm.pid}`)

        // Try to stop RNode on server exit
        process.on('exit', () => stopRNodeProcess(this.useDocker()))
      }
    }

    this.connection.onInitialize(params => {
      if (params.rootPath) {
        this.workspaceRoot = Uri.file(params.rootPath)
      } else if (params.rootUri) {
        this.workspaceRoot = Uri.parse(params.rootUri)
      }
      return {
        capabilities: {
          textDocumentSync: this.documents.syncKind,
          hoverProvider: false,
          documentSymbolProvider: false,
          documentRangeFormattingProvider: false,
        }
      }
    })

    // Evaluate the code on save document
    this.connection.onDidSaveTextDocument(params => {
      const uri = params.textDocument.uri
      if(this.isReady) {
        this.evalCode(uri)
      } else if(this._settings.enableLanguageServer) {
          this.connection.window.showWarningMessage('RNode is starting, please wait...')
      }
    })

    // Settings
    let startDelayHandle : NodeJS.Timeout
    this.connection.onDidChangeConfiguration((change) => {
      this.log('Settings.' + yaml.stringify(change.settings))

      const oldSettings = this._settings
      this._settings    = change.settings.rholang || {}
      const diffs = (newS: Settings, oldS: Settings) => [
        [true              , newS.enableLanguageServer, oldS.enableLanguageServer],
        [true              , newS.enableDocker        , oldS.enableDocker],
        [true              , newS.dockerRunOptions    , oldS.dockerRunOptions],
        [!newS.enableDocker, newS.rnode               , oldS.rnode]  ,
        [newS.enableDocker , newS.rnodeDockerImage    , oldS.rnodeDockerImage],
      ]
      if(!oldSettings || diffs(this._settings, oldSettings).find(([s, x, y]) => s && x !== y)) {
        // If settings change
        oldSettings && 
          (oldSettings.enableDocker || oldSettings.dockerRunOptions) && 
          stopRNodeProcess(oldSettings.enableDocker)

        const startNode = () => {
          if (this._settings.enableLanguageServer) {
            log('Rholang Language Server (enabled)')
            startRNodeProcess()
          } else {
            log('Rholang Language Server (disabled)')
          }
        }
        // Small delay for rnode to die
        clearTimeout(startDelayHandle)
        startDelayHandle = setTimeout(startNode, 1500)
      }
    })

  }

  useDocker() { return this._settings.enableDocker }

  start() {
    this.connection.listen()
  }

  sendErrors(uri, ...msgs) {
    const diagnostics = msgs.map(x => ({
      severity: DiagnosticSeverity.Error,
      ...x
    }))
    this._settings.showAllOutput &&
      this.log('Diagnostics:\n' + yaml.stringify(diagnostics))
    this.connection.sendDiagnostics({ uri, diagnostics })
  }

  sendClear(uri) {
    const diagnostics = []
    this.connection.sendDiagnostics({ uri, diagnostics })
  }

  startRNode() {
    // Create working folder, as current user (Docker run as root)
    if (!fs.existsSync(workingFolder)) fs.ensureDir(workingFolder)

    // RNode ports
    const [port0, port1, port2, port3, port4] = [0, 1, 2, 3, 4].map(x => rnodePort0 + x)

    const runCmd = dir => [
      '--grpc-port', `${port1}`, '--grpc-port-internal', `${port2}`,
      'run', '-s', '-n', '--data-dir', dir, '--host', 'localhost', '--allow-private-addresses',
      '-p', `${port0}`, '--http-port', `${port3}`, '--kademlia-port', `${port4}`,
    ]

    const dockerCmd = runOptions => {
      const volume = `${workingFolder}:/vscode`
      let cmd = [
        // Docker run
        'run', '-i', '--rm', '--name', rhoTmpName, '-v', volume,
               '-p', `${port0}:${port0}`, '-p', `${port1}:${port1}`, '-p', `${port2}:${port2}`,
               '-p', `${port3}:${port3}`, '-p', `${port4}:${port4}`,
       ]
      runOptions && runOptions.length != 0 && cmd.push(`${runOptions}`)
      cmd.push(this._settings.rnodeDockerImage)
      cmd.push(...runCmd('/vscode/.rnode'))
      return cmd
    }

    // Start RNode (standalone) process used by the server
    let vm: ChildProcess
    if (this.useDocker()) {
      vm = spawn('docker', dockerCmd(this._settings.dockerRunOptions))
    } else {
      // RNode run
      vm = spawn(this._settings.rnode, runCmd(dataDir))
    }

    if (!vm.pid) {
      vm.on('error', error => {
        this.log(`${error}`)
      })
      return
    }

    vm.stderr.on('data', data => {
      const result = `${data}`

      if (result.trim() === '') return

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

      // [rchain] Error: ...
      const rchainError = regexec(/\[rchain\] (Error: .+)./g, result)
      if (rchainError) {
        const [_, err] = rchainError
        this.log('')
        this.log(err)
      }

      const knownMsg = syntaxError || rchainError
      if (!knownMsg) {
        // This will catch Docker downloading messages
        process.stdout.write(data)
      }
    })

    let isStarted = false

    // RNode stdout
    vm.stdout.on('data', data => {
      const result = `${data}`.replace(/[\n\r]*$/, '').trim()

      if (result === '') return

      // Display RNode output
      if (this._settings.showAllOutput) {
        this.log(result)
      } else if (!this.isReady) {
        // Display RNode version info
        // RChain Node 0.9.1.git4af26be5 (4af26be585c905097be5d474acce693e059ab64b)
        const versionInfo = !isStarted && regexec(/INFO  coop.rchain.node.Main\$ - (RChain Node .*)/g, result)
        if (versionInfo) {
          // Display version info
          const [_, version] = versionInfo
          process.stdout.write(`Starting ${version} `)
          isStarted = true
        }
        // Display progress as dots
        isStarted && process.stdout.write('.')
      } else {
        // Display evaluated code and result (skip info/warn logs)
        const nodeLog = regexec(/\[[a-z-]+[\d]+\] (WARN|INFO)/g, result)
        !nodeLog && this.log(result)
      }

      // Check for log message that node is ready
      const startListen = regexec(/Listening for traffic on rnode:\/\/([\s\S\d]+)./g, result)
      if (startListen) {
        // Create new gRPC client (after losing connection)
        this.grpcClient = new grpc.Client(rnodeUrl, grpc.credentials.createInsecure())
        // Get repl service path
        const replPath = 'coop.rchain.node.model.Repl'
        rnodeGetReplService(this.grpcClient)
          .then(({name}) => name)
          .catch(err => {
            this.log(``)
            this.log(`Can\'t get Repl service name, fallback to default ${replPath}, ${err.message}`)
            return replPath
          })
          .then(name => this.grpcReplServicePath = name)
          .finally(() => {
            this.isReady = true
            const [_, address] = startListen
            const msgReady = `Rholang VM is ready!`
            const msgListen = `Listening on rnode://${address}`
            const msg = `${msgReady} ${msgListen}`
            this.log('')
            this.log(msgListen)
            this.log(`Ports - gRPC external/internal ${port1}/${port2}`)
            this.log(`      - rnode/http/kademlia ${port0}/${port3}/${port4}`)
            this.log(msgReady)
            this.connection.window.showInformationMessage(msg)
          })
      }
    })
    return vm
  }

  evalCode(uri: string) {
    // Global uri until caller gets all errors
    this._uri = uri
    const document = this.documents.get(uri)
    const codeString = document.getText().replace(/\r/g, '')

    // Start Rholang VM (eval)
    this.log('')
    this.log('>>>>>>>>>>>>>>>>>>>>>> Sending code to Rholang VM >>>>>>>>>>>>>>>>>>>>>>')

    // Evaluate editor text
    rnodeReplEval({program: codeString, printunmatchedsendsonly: true}, this.grpcReplServicePath, this.grpcClient)
      .then(({output}) => this.processEvalResult(uri, output))
  }

  processEvalResult(uri, output: string) {
    // Ensure it's string
    const result = `${output}`

    if (result.trim() === '') return

    // Deployment cost: CostAccount(39,Cost(1165))
    // Deployment cost: Cost(718,)                     - v0.9.1
    const costRegex = /(Deployment cost:[^\n]+)/g
    const cost = regexec(costRegex, result)
    if (cost) {
      const [_, costMsg] = cost
      this.sendClear(uri)
      this.log('')
      this._settings.showAllOutput
        ? this.log(result)
        : this.log(costMsg)
    }

    // Compile errors

    const errorParsers = [{
      // Free names
      // Error: coop.rchain.rholang.interpreter.errors$TopLevelFreeVariablesNotAllowedError: Top level free variables are not allowed: x at 18:5.
      regex: /Error:[\s\S]+ (\d+):(\d+)\./g,
      diag: ([message, ...ranges]) => {
        const [sl, sc] = ranges.map(x => parseInt(x) - 1)
        const range = {
          start: { line: sl, character: sc },
          end: { line: sl, character: sc },
        }
        return [{ range, message }]
      }
    }, {
      // Name/Process type error
      // Error: coop.rchain.rholang.interpreter.errors$UnexpectedProcContext: Name variable: x at 17:5 used in process context at 17:17
      // Error: coop.rchain.rholang.interpreter.errors$UnexpectedNameContext: Proc variable: x at 19:6 used in Name context at 19:19
      regex: /Error:[\s\S]+ (\d+):(\d+) used in \w+ context at (\d+):(\d+)/g,
      diag: ([message, ...ranges]) => {
        const [sl1, sc1, sl2, sc2] = ranges.map(x => parseInt(x) - 1)
        // Make range with the same start/end
        const r = (line, character, msg) => ({ range: { start: { line, character }, end: { line, character }, }, message: msg })
        return [r(sl1, sc1, message), r(sl2, sc2, message)]
      }
    }, {
      // Error with line identification
      // Error: coop.rchain.rholang.interpreter.errors$LexerError: Illegal Character <?> at 4:4(9)
      regex: /Error:[\s\S]+ (\d+):(\d+)[\s\S]+/g,
      diag: ([message, ...ranges]) => {
        const [sl, sc] = ranges.map(x => parseInt(x) - 1)
        const range = {
          start: { line: sl, character: sc },
          end: { line: sl, character: sc },
        }
        return [{ range, message }]
      }
    }, {
      // Errors received during evaluation
      regex: /Errors received during evaluation:[\n\r]*([\s\S\n\r]+)Storage Contents:/g,
      diag: ([message, error]) => {
        const range = {
          start: { line: 0, character: 0 },
          end: { line: Number.MAX_VALUE, character: Number.MAX_VALUE },
        }
        return [{ range, message: `Error: ${error}` }]
      }
    }, {
      // Any other error
      regex: /Error:[\s\S]+/g,
      diag: ([message, ...ranges]) => {
        const [sl, sc] = ranges.map(x => parseInt(x) - 1)
        const range = {
          start: { line: 0, character: 0 },
          end: { line: Number.MAX_VALUE, character: Number.MAX_VALUE },
        }
        return [{ range, message }]
      }
    }]

    const showError = str => ({regex, diag}) => {
      const match = regexec(regex, str)
      if (match) {
        const errors = diag(match)
        this.sendErrors(uri, ...errors)
        this.log('')
        this.log(errors[0].message)
      }
      return match
    }

    // Detect syntax error printed on RNode stdout
    const syntaxError = regexec(/Error:[\s\S]+ Unrecognized interpreter error/g, result)

    const shownMsg = syntaxError || errorParsers.find(showError(result)) || cost
    if (this._settings.showAllOutput && !shownMsg) {
      this.log('')
      this.log(`EVAL RESULT:\n${result}`)
    }
  }

}
