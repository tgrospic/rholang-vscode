import { createConnection, ProposedFeatures } from 'vscode-languageserver';
import { RholangServer } from './rholang-server'

const connection = createConnection(ProposedFeatures.all)

const rhoServer = new RholangServer(connection)

rhoServer.start()
