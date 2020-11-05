# Rholang for VSCode

<img src="https://github.com/tgrospic/rholang-vscode/raw/master/assets/rchain.png"/>

<!-- ![beta][beta-badge] VSCode restriction for SVG in README -->

This is Visual Studio Code extension for [**Rholang**][rholang] programming language. It has support for syntax highlighting and code evaluation with error highlighting.

> **Rholang** is a fully featured, general purpose, Turing-complete programming language built from the rho-calculus. It is a behaviorally typed, **r**-eflective, **h**-igher **o**-rder process language and the official smart contracting language of [RChain][rchain-coop]. Its purpose is to concretize fine-grained, programmatic concurrency. [RChain Architecture][arch-rholang]

Rholang is currently in active development and syntax can slightly change. Current version of the plugin follows this version of [Rho grammar][rho-bnf-origin] and available examples.

Programmers in concurrent languages such as Erlang/Elixir say that one of the hardest problems is to coordinate the names (locations) of processes. It seems that Rholang with [Namespace logic][arch-namespace-logic] looks like a great solution for coordination of resources.

With all this sweet superpowers, that comes with the Rholang compiler and type checker, it is a pleasure to write (smart) `contract`s. :lollipop:

## How to use this extension

Just **open** your favorite **`.rho`** file, **write** some exciting **Rholang** code, **save** the file and **enjoy** the results in VSCode **Output Panel**. :smile:

![Rho sample][screenshot]

In the _Output Panel_ you can see the progress when RNode instance is starting in the background. It will output the message and create notification when it's ready to evaluate the code.

The Language Server is enabled and runs locally installed RNode by default. If RNode is not installed (not in the path, in extension settings it can be switched to use Docker or set custom RNode executable location.

| Settings               | Default | Description
| ---------------------- | ------- | ------------
| Enable Language Server | `true`  | Enable loading of the Language Server and RNode when open a file.
| Enable Docker          | `false` | Run RNode with Docker.
| RNode                  | `rnode` | RNode executable (path) used by Rholang Language Server.
| RNode Docker Image     | `rchain/rnode` | Docker image (version) used by Rholang Language Server.
| Show All Output        | `false` | Show all output from RNode in Output Panel.

Currently, one RNode instance is created with one VSCode instance. For each RNode instance unique temp directory is created which holds `.rnode` data directory. If VSCode window is reloaded it will create a fresh instance of RNode also.

## Learn Rholang By Example

If you are new to Rholang I recommend to visit Joshy Orndorff's excellent introduction [Learn Rholang By Example](https://github.com/JoshOrndorff/LearnRholangByExample) for beginners and intermediate programmers.

## TODO

- add commands, completion, hovers...
- connect with the compiler (get semantic info)
- ...

## Publish

### [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/vscode)   
`vsce publish -p <token>`

### [Open VSX Registry](https://open-vsx.org)  
`ovsx publish -p <token>`

## Release Notes

### 0.6.0 (October 06, 2019)
- Switch to gRPC connection :rocket:
- Update for RNode v0.9.{14,15} (new API)

### 0.5.0 (June 13, 2019)
- Update RNode option `--allow-private-addresses`

### 0.4.0 (May 18, 2019)
- Update for RNode v0.9.5

### 0.3.0 (April 20, 2019)
- Support for RNode installed locally
- Fix v0.9.3 - error detection, cost output

### 0.2.0 (February 11, 2019)
- Docker image user settings

### 0.1.0 (February 02, 2019)
- Grammar update for Rholang Mercury release v0.8>.
- **Rholang Language Server** with error highlighting.
- Snippets for basic Rholang terms.

### 0.0.1 (January 28, 2018)
- Initial release. Syntax highlighting.

## License

[The MIT License (MIT)][license]

[rholang]: https://github.com/rchain/rchain/blob/master/docs/rholang/rholangtut.md
[releases]: https://github.com/tgrospic/rholang-vscode/releases
[rchain-coop]: https://www.rchain.coop
[rho-github]: https://github.com/rchain/rchain/tree/master/rholang
[rho-bnf-origin]: https://github.com/rchain/rchain/blob/243a3fd7b1d7f1b9669920da80f419e84fbd02b6/rholang/src/main/bnfc/rholang_mercury.cf
[arch-rholang]: http://rchain-architecture.readthedocs.io/en/latest/contracts/contract-design.html#rholang-a-concurrent-language
[arch-namespace-logic]: http://rchain-architecture.readthedocs.io/en/latest/contracts/namespaces.html#namespace-logic
[tuplespaces-to-picalculus]: http://mobile-process-calculi-for-programming-the-new-blockchain.readthedocs.io/en/latest/actors-tuples-and-pi.html#from-tuplespaces-to-calculus

[beta-badge]: https://cdn.jsdelivr.net/gh/tgrospic/rholang-vscode@v0.6.1/assets/beta.svg
[screenshot]: https://github.com/tgrospic/rholang-vscode/raw/v0.3.0/assets/rholang-sample.gif
[license]: https://github.com/tgrospic/rholang-vscode/blob/master/LICENSE
