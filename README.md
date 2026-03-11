# RouteFlow Map

A Power BI custom visual for animated origin-destination flow mapping on Mapbox. Supports multi-leg route chaining, gradient arc colors, particle animations, and rich hover tooltips.

## Features

- Multi-leg route visualization with automatic leg ordering
- Animated particle flow along bezier arcs
- Gradient arc colors (configurable start/end)
- Glassmorphism hover tooltips with per-leg and route-total breakdowns
- Configurable node markers and labels
- 5 Mapbox base map styles (dark, light, satellite, navigation)

## Data Fields

| Field | Type | Description |
|-------|------|-------------|
| Route String | Category | Full route string to chain legs (e.g. `[Carrier][Origin][Destination]-[Carrier][Origin][Destination]-[Carrier][Origin][Destination]`) |
| Leg Origin Code | Category | Origin location code for this leg |
| Leg Dest Code | Category | Destination location code for this leg |
| Origin Name | Category | Display name for origin |
| Destination Name | Category | Display name for destination |
| Origin Lat/Lon | Measure | Coordinates of origin point |
| Dest Lat/Lon | Measure | Coordinates of destination point |
| Values | Measure | Metric to display (cost, weight, etc.) |

## Mapbox Token

This visual requires a [Mapbox access token](https://account.mapbox.com/access-tokens/) to load map tiles.

1. Sign up at [mapbox.com](https://www.mapbox.com/) (free tier includes 50k map loads/month)
2. Copy your **Default public token** from the Mapbox dashboard
3. In Power BI, select the visual → Format pane → **Map Settings** → paste your token into **Mapbox Access Token**

## Setup

1. Install [Node.js](https://nodejs.org/) and the Power BI visual tools:
   ```
   npm install -g powerbi-visuals-tools
   ```
2. Clone and install:
   ```
   git clone <repo-url>
   cd flowMapVisual
   npm install
   ```
3. Build:
   ```
   pbiviz package
   ```
4. Import the generated `.pbiviz` from the `dist/` folder into Power BI.

## License

MIT
