# Firma de la distribución Windows

Sentinel no incluye ni genera certificados. El instalador normal puede construirse
sin firma para validación local; la entrega pública debe usar un certificado de
firma de código adquirido y custodiado por su propietario.

## Variables requeridas

```powershell
$env:CSC_LINK = 'C:\ruta-segura\certificado.pfx'
$env:CSC_KEY_PASSWORD = 'contraseña-del-certificado'
npm run dist:win:signed
```

`CSC_LINK` también puede ser una URL protegida o un `file:` URI admitido por
electron-builder. No se debe guardar el PFX ni su contraseña en Git, el paquete,
scripts, documentación real ni archivos `.env` distribuidos.

El comando firmado se detiene antes del build si faltan las variables. Tras crear
el instalador se debe comprobar `Get-AuthenticodeSignature` tanto sobre el
instalador como sobre `SentinelMarketsAI.exe`, además de verificar timestamp,
editor y cadena de confianza.
