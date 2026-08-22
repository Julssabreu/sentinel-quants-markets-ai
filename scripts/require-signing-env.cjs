const fs = require('fs');

const certificate = String(process.env.CSC_LINK || '').trim();
const password = String(process.env.CSC_KEY_PASSWORD || '').trim();
if (!certificate || !password) {
  console.error('Firma bloqueada: configura CSC_LINK y CSC_KEY_PASSWORD antes de crear una distribución firmada.');
  process.exit(1);
}
const encodedCertificate=certificate.length>100&&/^[A-Za-z0-9+/=]+$/.test(certificate);
if (!/^https?:|^file:|^data:|^[A-Za-z]:[\\/]/i.test(certificate) && !fs.existsSync(certificate) && !encodedCertificate) {
  console.error('Firma bloqueada: CSC_LINK no parece una URL, file URI, base64 o ruta de certificado válida.');
  process.exit(1);
}
console.log('Variables de firma presentes. electron-builder validará y aplicará el certificado.');
