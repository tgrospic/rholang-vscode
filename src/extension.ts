/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';

import { workspace, ExtensionContext } from 'vscode'
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient'

export function activate(context: ExtensionContext) {
  // The server is implemented in node
  let serverModule = context.asAbsolutePath(path.join('build', 'server.js'));
  // The debug options for the server
  let debugOptions = { execArgv: ["--nolazy", "--debug=6009"] };

  // If the extension is launch in debug mode the debug server options are use
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    // run: { module: serverModule, transport: TransportKind.stdio },
    // debug: { module: serverModule, transport: TransportKind.stdio, options: debugOptions }
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
  }

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for Rholang
    documentSelector: ['rho'],
    outputChannelName: 'Rholang',
    synchronize: {
      // Synchronize the setting section 'rholang' to the server
      configurationSection: 'rholang',
      // Notify the server about file changes to '.clientrc files contain in the workspace
      fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
    }
  }

  // Create the language client and start the client.
  let disposable = new LanguageClient('rho', 'Rholang Language Server', serverOptions, clientOptions).start();

  // Push the disposable to the context's subscriptions so that the
  // client can be deactivated on extension deactivation
  context.subscriptions.push(disposable);
}
