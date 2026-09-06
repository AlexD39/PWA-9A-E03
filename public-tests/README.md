# Check público de estructura

Desde la raíz del proyecto: `bash public-tests/check.sh` o, sin Bash, `node scripts/verify.mjs --structure`. Solo comprueba archivos requeridos. No califica documentos ni detecta secretos.

Para prueba y build usen `npm run verify`; produce `reports/verification.json`. La calidad del contenido se revisa con la rúbrica.
