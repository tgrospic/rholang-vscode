'use strict'

import * as path from 'path'

import { workspace, ExtensionContext } from 'vscode'
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient'

export function activate(context: ExtensionContext) {
  // The Rholang Language Server path
  const serverModule = context.asAbsolutePath(path.join('build/src', 'server.js'))
  // The debug options for the server
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] }

  // If the extension is launch in debug mode the debug server options are use
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    // run: { module: serverModule, transport: TransportKind.stdio },
    // debug: { module: serverModule, transport: TransportKind.stdio, options: debugOptions }
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
  }

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for Rholang
    documentSelector: ['rho'],
    outputChannelName: 'Rholang',
    synchronize: {
      // Synchronize the setting section 'rholang' to the server
      configurationSection: 'rholang',
      // Notify the server about file changes to '.rholangrc files contain in the workspace
      // fileEvents: workspace.createFileSystemWatcher('**/.rholangrc')
    }
  }

  // Create the language client and start the client.
  const disposable = new LanguageClient('rho', 'Rholang Language Server', serverOptions, clientOptions).start()

  // Push the disposable to the context's subscriptions so that the
  // client can be deactivated on extension deactivation
  context.subscriptions.push(disposable)
}
