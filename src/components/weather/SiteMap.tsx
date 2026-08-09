"use client";

import { MapContainer, Marker, TileLayer } from "react-leaflet";
import { icon as leafletIcon } from "leaflet";
import "leaflet/dist/leaflet.css";

type Site = {
  id: string;
  lat: number;
  lon: number;
  name: string;
  code: string;
  kind: string;
};

const siteMarkerIcon = leafletIcon({
  iconUrl: "/leaflet/marker-icon.png",
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  shadowUrl: "/leaflet/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export function SiteMap({ sites, onSelect }: { sites: Site[]; onSelect: (site: Site) => void }) {
  return (
    <MapContainer center={[36.5, 138]} zoom={5} scrollWheelZoom className="h-full w-full">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      {sites.map((site) => (
        <Marker
          key={site.id}
          position={[site.lat, site.lon]}
          icon={siteMarkerIcon}
          eventHandlers={{ click: () => onSelect(site) }}
        />
      ))}
    </MapContainer>
  );
}
