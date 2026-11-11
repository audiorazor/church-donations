# Church Donations

Desktop app (Electron) for logging church donations and producing year-end giving letters as PDFs.
Built for Yellow Frame Presbyterian Church.

- Donors grouped into households; each person gets their own letter or a combined household letter
- Gifts by date, fund and method (check, cash, other, non-cash item with description only)
- Year-end letters as one PDF per letter and/or one combined PDF for printing
- All records in one local data file, with dated automatic copies and manual backup/restore

No donor data is stored in this repository.

## Run from source

    npm install
    npm start

## Builds

Every push to `main` builds the Apple Silicon Mac app and the Windows installer and publishes them
under Releases, tagged with the version in `package.json`.
