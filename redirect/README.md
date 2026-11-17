# Redirect for the old PDF Marker URL

GitHub does not redirect a Pages site when its repo is renamed, so once this repo is `red-pen`,
`https://witels0n.github.io/pdf-marker/` would return a 404. To keep old links and bookmarks working,
publish `pdf-marker/index.html` from this folder at that path, in one of two ways:

- **A new repo named `pdf-marker`**: put the file at the repo root as `index.html`, then in its
  settings turn on Pages from the `main` branch.
- **Your `witels0n.github.io` repo** (if you have one): add the file as `pdf-marker/index.html`.

This folder is not part of the Red Pen build.
