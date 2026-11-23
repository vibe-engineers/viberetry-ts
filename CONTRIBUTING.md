### Contributing

For a bug fix or feature, open an issue in the VibeRetry TypeScript repository. A small documentation correction can go straight into a pull request. Include the package name and a minimal example when reporting unexpected behavior. GitHub offers the repository's templates when you open an issue or pull request. [VibeRetry issues](https://github.com/vibe-engineers/viberetry-ts/issues/new/choose)

VibeRetry follows a forking workflow. Branch from `main` in your fork, make the change, and open a pull request describing its purpose and how you tested it. Run `npm run lint` and `npm test` from the repository root. For a change to Python compatibility, also run `npm run test:parity` with the Python reference environment. [Testing instructions](docs/DeveloperGuide.md#testing)

### Releasing to npm

Maintainers can preview a release from **Actions → Publish to npm → Run workflow**. The workflow tests the package across supported Node.js versions and checks the exact npm archive installed by the tests.

For a release, update the version in the manifest and lockfile, update the changelog, then push a matching Git tag (for example, `v0.1.0`) on a commit from `main`. GitHub Actions uses npm trusted publishing to publish the tested archive automatically with signed provenance. The workflow checks its public npm integrity and provenance after publishing. Stable releases use `latest` and prereleases use `next`. [Publish workflow](https://github.com/vibe-engineers/viberetry-ts/actions/workflows/publish.yml) · [npm provenance](https://docs.npmjs.com/viewing-package-provenance/)

The tagged workflow requires the locked VibeTools version to be available on npm. Publish VibeTools first and verify its registry integrity matches this repository’s lockfile.

### Hacktoberfest Participation (October Yearly)

In October, the maintainers mark tasks for Hacktoberfest. [Open Hacktoberfest issues](https://github.com/vibe-engineers/viberetry-ts/issues?q=is%3Aissue+is%3Aopen+label%3Ahacktoberfest)

#### How to Get Involved

1. Try the example in the project README. [VibeRetry README](README.md)
2. Comment on an open issue and wait for a maintainer to assign it to you.
3. Read the sections of the guide that cover your change. [Developer Guide](docs/DeveloperGuide.md)
4. Submit a focused pull request with the related issue, updated tests, and any changes to the examples.

#### Need Assistance?

For implementation questions, contact the team on Discord. The Contributor Covenant applies in project spaces. [Community Discord](https://discord.gg/dBW35GBCPZ) · [Code of Conduct](CODE_OF_CONDUCT.md)
