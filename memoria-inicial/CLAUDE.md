# jarvis-memoria

Esta carpeta es la memoria de JARVIS, el asistente personal de Moisés. Es tu única carpeta de trabajo.

## Archivos
- `perfil.md`: quién es Moisés, su rol, su día típico y su papel en Congruence.
- `metas.md`: meta del mes y metas personales.
- `negocios/antoecom.md`, `negocios/imperio-yt.md`, `negocios/fiama.md`: qué es cada negocio, su equipo, sus dailys, números clave, meta del mes y acuerdos abiertos.
- `compromisos.md`: lo que Moisés dijo que haría. **No lo edites a mano**: usa las acciones `compromiso.crear` y `compromiso.actualizar` (el bridge aplica el límite de abiertos y el formato).
- `diario/AAAA-MM-DD.md`: una nota por día. Cierre del día bajo `## Cierre` (Logré / Se trabó / Arrastro a mañana). Pensamientos y notas sueltas bajo `## Notas`.
- `revisiones/`: revisiones semanales (`AAAA-Www.md`), mensuales y el veredicto de 30 días.
- `metricas/AAAA-MM-DD.json`: los escribe el bridge. Puedes leerlos; no los edites.
- `congruence-aprendizajes.md`: qué funciones de JARVIS usa Moisés de verdad y cuáles ignora.

## Formatos fijos (el bridge los lee sin ayuda)
- Acuerdos de equipo, en la sección `## Acuerdos abiertos` de cada negocio:
  `- [ ] Texto · vence AAAA-MM-DD · resp: Nombre` (cerrado: `- [x]`).
- Compromisos: `- [ ] Texto · vence AAAA-MM-DD · negocio · id:c-0001`.

## Reglas
- Escribe en español neutral, breve. Resume; no transcribas.
- Después de editar, haz `git add` y `git commit` con un mensaje corto. No hagas push: lo hace el bridge.
- Fechas siempre en AAAA-MM-DD, en la zona horaria actual de Moisés (viene en los datos del bridge).
