		maplibregl.setWorkerUrl(staticFile('maplibre/maplibre-gl-worker.mjs'));

		const mapInstance = new maplibregl.Map({
			container: containerRef.current,
			style: 'https://demotiles.maplibre.org/style.json',
			center: zurich,
			zoom: 7,
			interactive: false,
			attributionControl: false,
			fadeDuration: 0,
			canvasContextAttributes: {
				preserveDrawingBuffer: true,
			},
		});

		mapInstance.on('load', () => {
			mapInstance.addSource('trace', {
