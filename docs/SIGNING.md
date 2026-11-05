# Code signing (free, self-signed)

There is no free **publicly trusted** code-signing certificate (Let's Encrypt does not issue them;
SignPath Foundation is free only for OSI-licensed open-source projects, which this proprietary app is not).
The rebuild is therefore signed with a free self-signed certificate. Importing its public key on each PC
makes Windows treat the signature as valid.

## The certificate

* Subject: `CN=Waseela ERP, O=Abuzar Consultancy, C=PK`
* Type: code-signing (EKU 1.3.6.1.5.5.7.3.3), RSA 2048, **SHA-256**, key usage Digital Signature
* Thumbprint: `F5D7EB3785293958A84745D021722492BD535800`
* Valid: 2026-11-06 to 2046-11-06
* Public key at `docs/Waseela-ERP.cer` (safe to copy/share); also attached to the `build-11` release.
* Private key exists only on the signing PC (`Cert:\CurrentUser\My`); never export it into the repository.

The older SHA-1 certificate `4CB4FD989CEF1FBB78B44BECD412601AD178351F` (valid to 2036) signs the original
PowerBuilder launcher only - do not use it for the rebuild.

## Install the certificate on a PC (administrator)

```
certutil -addstore Root Waseela-ERP.cer
certutil -addstore TrustedPublisher Waseela-ERP.cer
```

Verify anything signed with it:

```
Get-AuthenticodeSignature .\Trader_0.1.0_x64-setup.exe
```

`Status` must read `Valid`. With the certificate imported as above, SmartScreen normally does not block
the installer; if it still shows for an unrecognised publisher on the first run, choose
**More info > Run anyway** (or import to `TrustedPublisher` first).

## What is signed

Release `build-11` (and future releases signed the same way):

* `Trader_0.1.0_x64-setup.exe` - SHA-256 `63b7528c08dd7a82d16213060645cb11978326ad3bc1a97a957382c517bc5bc5`
* `trader-desktop.exe`
* `trader-server.exe`

All three were timestamped (http://timestamp.digicert.com) at signing time.

## Re-signing a release locally (after `release.yml` has built it)

```powershell
$tag  = 'build-12'
$dir  = "$env:TEMP\$tag"; New-Item -ItemType Directory -Force $dir | Out-Null
gh release download $tag --dir $dir --repo jerryboganda/abuzar-rebuild
$cert = Get-Item Cert:\CurrentUser\My\F5D7EB3785293958A84745D021722492BD535800
Get-ChildItem $dir -Filter *.exe | ForEach-Object {
  Set-AuthenticodeSignature -FilePath $_.FullName -Certificate $cert -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
}
gh release upload $tag (Join-Path $dir '*.exe') --clobber
certutil -hashfile (Join-Path $dir 'Trader_0.1.0_x64-setup.exe') SHA256
```

Update the hash printed in this file and in `docs/OPERATIONS.md` afterwards. Signing stays local; do not
add the private key to Actions secrets of the (public) repository.
