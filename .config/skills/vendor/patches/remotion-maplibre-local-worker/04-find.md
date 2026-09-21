		maplibregl.setWorkerUrl(
			URL.createObjectURL(
				new Blob(
					[`import "https://unpkg.com/maplibre-gl@${maplibregl.getVersion()}/dist/maplibre-gl-worker.mjs";`],
					{type: 'text/javascript'},
				),
			),
		);

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
			mapInstance.jumpTo({center: zurich, zoom: 7});
