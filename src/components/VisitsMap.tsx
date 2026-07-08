import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPinCategory = "active" | "planned" | "completed" | "additional";

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  category: MapPinCategory;
};

export const PIN_CATEGORY_COLOR: Record<MapPinCategory, string> = {
  active: "#0284c7", // niebieski — w trakcie realizacji
  planned: "#d97706", // bursztynowy — zaplanowane
  completed: "#059669", // zielony — zakończone dzisiaj
  additional: "#7c3aed", // fioletowy — zlecenia dodatkowe
};

// Domyślny środek mapy: Trójmiasto / Pruszcz Gdański, używany gdy brak pinów
const DEFAULT_CENTER: [number, number] = [54.258, 18.4];

function FitBounds({ pins }: { pins: MapPin[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) return;
    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], 14);
      return;
    }
    const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
  }, [pins, map]);
  return null;
}

export function VisitsMap({
  pins,
  highlight,
}: {
  pins: MapPin[];
  highlight: MapPinCategory | null;
}) {
  return (
    <div className="h-full w-full overflow-hidden rounded-lg border">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={13}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds pins={pins} />
        {pins.map((p) => {
          const dimmed = highlight !== null && highlight !== p.category;
          return (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={highlight === p.category ? 11 : 8}
              pathOptions={{
                color: "#ffffff",
                weight: 2,
                fillColor: PIN_CATEGORY_COLOR[p.category],
                fillOpacity: dimmed ? 0.25 : 0.95,
                opacity: dimmed ? 0.4 : 1,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                {p.label}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
