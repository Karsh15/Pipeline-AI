"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { mockDeals, formatCurrency, type Deal } from "@/lib/mockData";

const STATUS_COLORS: Record<string, string> = {
  LOI:          "#F59E0B",
  Underwriting: "#3B82F6",
  Tracking:     "#10B981",
  Dead:         "#9CA3AF",
};

function makePinIcon(color: string, selected: boolean): L.DivIcon {
  const size = selected ? 44 : 36;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 44 44">
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="rgba(0,0,0,0.28)"/>
      </filter>
      <!-- White card background -->
      <rect x="4" y="4" width="32" height="28" rx="7" ry="7"
        fill="white" filter="url(#shadow)" />
      <!-- Colored top bar -->
      <rect x="4" y="4" width="32" height="9" rx="7" ry="7" fill="${color}" />
      <rect x="4" y="9" width="32" height="4" fill="${color}" />
      <!-- Pin icon inside white card -->
      <path d="M22 16 C19.24 16 17 18.24 17 21 C17 24.75 22 30 22 30 C22 30 27 24.75 27 21 C27 18.24 24.76 16 22 16Z"
        fill="${color}" opacity="0.9"/>
      <circle cx="22" cy="21" r="2.5" fill="white"/>
      <!-- Bottom triangle pointer -->
      <path d="M18 31 L22 37 L26 31Z" fill="white" filter="url(#shadow)"/>
      <path d="M18 31 L22 37 L26 31Z" fill="white"/>
    </svg>`;

  return new L.DivIcon({
    html: svg,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

function MapRecenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, 12, { animate: true, duration: 1.5 });
  }, [center, map]);
  return null;
}

export default function Map({
  selectedDealId,
  deals: dealsProp,
  instanceId = "main",
}: {
  selectedDealId: string | null;
  deals?: Deal[];
  instanceId?: string;
}) {
  const deals = dealsProp ?? mockDeals;
  const defaultCenter: [number, number] = [39.8283, -98.5795];
  const selectedDeal = deals.find((d) => d.id === selectedDealId);
  const mapCenter: [number, number] = selectedDeal
    ? [selectedDeal.lat, selectedDeal.lng]
    : defaultCenter;

  return (
    <MapContainer
      key={`deal-pipeline-map-${instanceId}`}
      center={mapCenter}
      zoom={selectedDeal ? 12 : 4}
      style={{ height: "100%", width: "100%", zIndex: 0 }}
      zoomControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />

      <MapRecenter center={mapCenter} />

      {deals.map((deal) => {
        const color = STATUS_COLORS[deal.status] ?? "#6366F1";
        const isSelected = deal.id === selectedDealId;
        return (
          <Marker
            key={deal.id}
            position={[deal.lat, deal.lng]}
            icon={makePinIcon(color, isSelected)}
            zIndexOffset={isSelected ? 1000 : 0}
          >
            <Popup>
              <div className="font-sans min-w-[180px] p-1">
                <div
                  className="text-[10px] font-black uppercase tracking-widest mb-1 px-1.5 py-0.5 rounded inline-block"
                  style={{ background: color + "20", color }}
                >
                  {deal.status}
                </div>
                <div className="font-bold text-sm text-slate-800 leading-tight mb-0.5">
                  {deal.name}
                </div>
                <div className="text-[11px] text-slate-500 mb-2">
                  {deal.city}, {deal.state}
                </div>
                <div className="flex justify-between text-[11px] border-t border-slate-100 pt-1.5">
                  <span className="text-slate-500">Ask Price</span>
                  <span className="font-semibold text-slate-800">
                    {formatCurrency(deal.guidancePrice)}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] pt-0.5">
                  <span className="text-slate-500">Cap Rate</span>
                  <span className="font-semibold text-slate-800">{deal.capRate}%</span>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
