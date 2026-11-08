# causeway releases

Public release artifacts for causeway.

## Install

macOS and Linux:

```bash
curl -fsSL https://github.com/ddfourtwo/causeway-releases/releases/latest/download/install | bash
```

Windows, in a normal PowerShell window (not "Run as administrator"):

```powershell
irm https://github.com/ddfourtwo/causeway-releases/releases/latest/download/install.ps1 | iex
```

The installer downloads the latest release, checks it against `SHA256SUMS`, then hands over to `causeway-setup`, which installs everything, walks you through the sign-ins and checks each part. If it stops, run the same command again: it resumes.

To pin a version, set `CAUSEWAY_VERSION` (e.g. `CAUSEWAY_VERSION=1.9.0`) before running it.

## Uninstall

macOS and Linux:

```bash
curl -fsSL https://github.com/ddfourtwo/causeway-releases/releases/latest/download/uninstall | bash
```
