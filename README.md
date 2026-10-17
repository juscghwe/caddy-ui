# caddy/ui architecture workspace

This branch holds architecture proposals, current implementation maps and plans for independently reviewable implementation slices.

- [Architecture and boundary proposal](caddy-ui-architecture-proposal.md)
- [Current backend: modules, contracts and responsibility diagrams](backend-current-architecture.md)
- [Implementation slice documents](slices/README.md)

The guiding principle is a small, dependable, Caddyfile-first tool. Clear responsibilities, contracts, testing and recovery should support that simplicity.

Application source lives on [main](https://github.com/juscghwe/caddy-ui/tree/main). Start implementation branches from the current application branch and bring over the relevant plan. This documentation branch has a separate working tree layout and should not be merged wholesale into the application.

Proposals remain discussion drafts until their individual decisions are agreed. The architecture proposal is preserved as supplied; subsequent documents can refine it and record decisions.
