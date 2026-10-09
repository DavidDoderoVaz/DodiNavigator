# DodiNavigator 1.2

Navegador web basado en Chromium (Electron).

## Requisitos
- Node.js 18 o superior (https://nodejs.org)

## Probarlo
```
npm install
npm start
```

## Crear el .exe (Windows)
```
npm run dist
```
En `dist/` aparecen el instalador (`DodiNavigator Setup 1.3.0.exe`) y la versión portable.
Si falla con un error de "symbolic link / privilegios": abre la terminal como Administrador
o activa el "Modo de desarrollador" de Windows, y repite.

Para Mac o Linux: `npm run dist:mac` / `npm run dist:linux` (hay que ejecutarlos en ese sistema).

## Qué incluye
- Pestañas: arrastrar para reordenar, fijar, duplicar, reabrir cerradas, pestañas privadas (sin historial ni cookies guardadas)
- Grupos con nombre y color: clic derecho en una pestaña para crear, cambiar o mover de grupo
- Perfiles de navegación: separan cookies e inicios de sesión; favoritos e historial se comparten
- Restaura las pestañas al abrir (se puede desactivar en Ajustes)
- Barra de direcciones y buscador a elección (DuckDuckGo, Google, Bing, Brave)
- Favoritos (barra + panel lateral) y bloc de notas en el panel lateral
- Historial con búsqueda (dodi://history), Descargas con pausa y reanudación (dodi://downloads), Ajustes (dodi://settings)
- Buscar en la página, zoom, modo lectura, guardar páginas en PDF y capturar páginas en PNG
- Bloqueador de anuncios y rastreadores (paquete opcional @ghostery/adblocker-electron)
- Accesos directos editables en la nueva pestaña, tema claro/oscuro y color de acento
- Menú contextual (clic derecho): abrir enlace en pestaña, copiar, guardar imagen, inspeccionar
- Los permisos de cámara, micrófono, ubicación y notificaciones se piden y recuerdan por sitio; se pueden revocar en Ajustes
- Extensiones compatibles: se añaden desde Ajustes seleccionando una carpeta con `manifest.json`; se cargan en los perfiles persistentes
- Estadísticas en la nueva pestaña: memoria y CPU aproximados, además de solicitudes bloqueadas durante el día
- Suspensión opcional de pestañas web inactivas y uso de memoria aproximado por pestaña en Ajustes; las pestañas suspendidas recargan el sitio al abrirlas
- Buscador de actualizaciones en Ajustes; el autoactualizador está disponible en la versión instalada (NSIS), no en `npm start` ni en la versión portable
- Opción para borrar historial, cookies, permisos y caché al cerrar
- Aviso cuando se bloquea una conexión por un error de certificado; no permite saltarse la protección TLS

## Atajos
Ctrl+T nueva · Ctrl+Shift+N privada · Ctrl+Shift+T reabrir · Ctrl+W cerrar · Ctrl+L dirección
Ctrl+F buscar · Ctrl++ / Ctrl+- / Ctrl+0 zoom · Ctrl+B panel lateral · Ctrl+H historial
Ctrl+J descargas · Ctrl+, ajustes · Ctrl+Alt+R modo lectura · Ctrl+Alt+T traducir
Alt+← / Alt+→ atrás/adelante · Alt+Inicio inicio · Ctrl+Tab cambiar pestaña · F12 herramientas

## Datos
Se guardan en la carpeta de datos del usuario (en Windows: %APPDATA%\dodinavigator):
ajustes, favoritos, notas, historial y lista de descargas, en archivos JSON.

## Bloqueador y actualizaciones
Ghostery usa listas de filtros públicas para bloquear anuncios y rastreadores. Los sitios todavía pueden detectar que su contenido publicitario no se carga; no se incluyen técnicas para ocultar el bloqueador o evadir las comprobaciones de los sitios.

El actualizador consulta versiones públicas en GitHub Releases. La acción de GitHub compila y publica los instaladores de Windows al subir una etiqueta `v*` (por ejemplo, `v1.3.0`). El primer paquete actualizado todavía debe publicarse como release para que las instalaciones existentes puedan recibirlo. La actualización automática funciona con el instalador NSIS, no con la versión portable.

Electron admite solo una parte de las API de extensiones de Chrome. DodiNavigator carga extensiones desempaquetadas (carpetas), no instala `.crx` ni directamente desde Chrome Web Store; algunas extensiones y sus botones pueden no funcionar.

DodiNavigator todavía no incluye una VPN. Para ofrecer una conexión VPN real hay que integrar un proveedor o una conexión VPN configurada en el sistema; el indicador de la nueva pestaña deja claro que no está configurada.

