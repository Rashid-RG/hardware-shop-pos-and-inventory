import React, { useState } from 'react';
import { Paintbrush, Hammer, Layers, ShieldAlert, BadgePercent, Coins, ClipboardList } from 'lucide-react';

import type { Product, QuotationItem } from '../types';

export type EstimateDraft = { item: QuotationItem; notes: string };

interface CalculatorsViewProps {
  products?: Product[];
  onQuote?: (draft: EstimateDraft) => void;
  taxConfig?: {
    taxRate: number;
    currency: string;
  };
}

export default function CalculatorsView({ products = [], onQuote, taxConfig = { taxRate: 18, currency: 'LKR' } }: CalculatorsViewProps) {
  const [subTab, setSubTab] = useState<'tile' | 'concrete' | 'paint' | 'brick-steel-timber' | 'business'>('tile');

  // --- 1. Tile Calculator States ---
  const [roomLength, setRoomLength] = useState<number>(12);
  const [roomWidth, setRoomWidth] = useState<number>(12);
  const [tileSizePreset, setTileSizePreset] = useState<string>('2x2'); // '1x1', '2x2', '2x4', '4x2', '12x24', '24x24', 'custom'
  const [customTileLength, setCustomTileLength] = useState<number>(2); // in feet
  const [customTileWidth, setCustomTileWidth] = useState<number>(2); // in feet
  const [tilesPerBox, setTilesPerBox] = useState<number>(4);
  const [productId, setProductId] = useState('');
  const [stockUnit, setStockUnit] = useState<'' | 'box' | 'tile'>('');
  const catalog = products.filter(product => product.status !== 'Inactive' && !product.variants?.length);
  const product = catalog.find(entry => entry.id === productId);
  const unitPrice = product && (product.wholesalePrice || product.sellingPrice);
  const [manualPrice, setPricePerBox] = useState<number>(2500);
  const [tileWaste, setTileWaste] = useState<number>(10); // in percent
  const [tileDeductions, setTileDeductions] = useState<number>(0); // non-tiled areas (sq.ft)

  // --- 2. Concrete/Cement States ---
  const [slabLength, setSlabLength] = useState<number>(20);
  const [slabWidth, setSlabWidth] = useState<number>(15);
  const [slabThickness, setSlabThickness] = useState<number>(4); // in inches
  const [concreteRatio, setConcreteRatio] = useState<string>('1:2:4'); // cement:sand:aggregate

  // --- 3. Paint Calculator States ---
  const [wallHeight, setWallHeight] = useState<number>(10);
  const [wallPerimeter, setWallPerimeter] = useState<number>(44); // sum of all walls length
  const [doorsCount, setDoorsCount] = useState<number>(1);
  const [windowsCount, setWindowsCount] = useState<number>(2);
  const [paintCoats, setPaintCoats] = useState<number>(2);
  const [paintCoverage, setPaintCoverage] = useState<number>(350); // sq.ft per gallon

  // --- 4. Bricks, Steel, Timber States ---
  const [wallL, setWallL] = useState<number>(30);
  const [wallH, setWallH] = useState<number>(10);
  const [wallT, setWallT] = useState<number>(9); // 4.5 or 9 inches
  const [brickL, setBrickL] = useState<number>(9);
  const [brickW, setBrickW] = useState<number>(4.5);
  const [brickH, setBrickH] = useState<number>(3);

  const [steelDiameter, setSteelDiameter] = useState<number>(12); // mm
  const [steelLength, setSteelLength] = useState<number>(40); // feet

  const [timberL, setTimberL] = useState<number>(12); // feet
  const [timberW, setTimberW] = useState<number>(4); // inches
  const [timberH, setTimberH] = useState<number>(2); // inches
  const [timberQty, setTimberQty] = useState<number>(10);
  const [timberPriceCft, setTimberPriceCft] = useState<number>(3500);

  // --- 5. Business Calculator States ---
  const [basePrice, setBasePrice] = useState<number>(1500);
  const [discountPct, setDiscountPct] = useState<number>(10);
  const [vatPct, setVatPct] = useState<number>(taxConfig.taxRate);

  const [costPrice, setCostPrice] = useState<number>(1000);
  const [marginPct, setMarginPct] = useState<number>(25);
  const [markupPct, setMarkupPct] = useState<number>(33.33);

  const [annualDemand, setAnnualDemand] = useState<number>(5000);
  const [orderingCost, setOrderingCost] = useState<number>(150);
  const [holdingCost, setHoldingCost] = useState<number>(12); // per unit per year
  const [leadTimeDays, setLeadTimeDays] = useState<number>(7);

  // ==========================================
  // CALCULATIONS
  // ==========================================

  // 1. Tile calculations
  const rawRoomArea = roomLength * roomWidth; // sq.ft
  const roomArea = Math.max(0, rawRoomArea - tileDeductions); // Deduct non-tiled areas (e.g. doors)
  let tileLength = customTileLength;
  let tileWidth = customTileWidth;
  if (tileSizePreset === '1x1') { tileLength = 1; tileWidth = 1; }
  else if (tileSizePreset === '2x2') { tileLength = 2; tileWidth = 2; }
  else if (tileSizePreset === '2x4') { tileLength = 2; tileWidth = 4; }
  else if (tileSizePreset === '4x2') { tileLength = 4; tileWidth = 2; }
  else if (tileSizePreset === '12x24') { tileLength = 1; tileWidth = 2; } // 12x24 in is 1x2 ft
  else if (tileSizePreset === '24x24') { tileLength = 2; tileWidth = 2; } // 24x24 in is 2x2 ft

  const tileArea = tileLength * tileWidth; // sq.ft
  const rawTilesRequired = tileArea > 0 ? roomArea / tileArea : 0;
  const netTiles = Math.ceil(rawTilesRequired);
  const totalTilesRequired = Math.ceil(rawTilesRequired * (100 + tileWaste) / 100);
  const tileWasteQty = totalTilesRequired - netTiles;
  const pricePerBox = product
    ? (unitPrice ?? 0) * (stockUnit === 'tile' ? tilesPerBox : 1)
    : manualPrice;
  const boxesRequired = tilesPerBox > 0 ? Math.ceil(totalTilesRequired / tilesPerBox) : 0;
  const tileTotalCost = boxesRequired * pricePerBox;
  const remainingStock = (boxesRequired * tilesPerBox) - totalTilesRequired;

  const stockNeeded = stockUnit === 'tile' ? boxesRequired * tilesPerBox : boxesRequired;
  const priceReady = !product || !!stockUnit;

  // Adhesive & Grout Estimates (Standard builders' formula)
  // Thinset mortar / adhesive: ~0.15 bags per sq.ft (25kg bags)
  // Grout: ~0.10 kg per sq.ft
  const adhesiveBags = Math.ceil(roomArea * 0.15);
  const groutKg = Math.ceil(roomArea * 0.1);

  // 2. Concrete/Cement calculations
  const slabVolumeCft = slabLength * slabWidth * (slabThickness / 12);
  const slabVolumeCum = slabVolumeCft * 0.0283168; // cft to cubic meters
  // Dry volume is 1.54 times wet volume
  const dryVolumeCum = slabVolumeCum * 1.54;
  // cement:sand:aggregate proportions
  let cementParts = 1, sandParts = 2, aggParts = 4;
  if (concreteRatio === '1:1.5:3') { cementParts = 1; sandParts = 1.5; aggParts = 3; }
  else if (concreteRatio === '1:3:6') { cementParts = 1; sandParts = 3; aggParts = 6; }
  const totalParts = cementParts + sandParts + aggParts;

  // 1 cum of dry concrete requires ~30 bags of cement (depending on mix)
  // For 1:2:4 mix: cement volume = (1/7)*dryVolume. Cement bags = cementVolume / 0.035
  const cementBags = Math.ceil((cementParts / totalParts) * dryVolumeCum / 0.035);
  const sandVolumeCft = Math.ceil((sandParts / totalParts) * dryVolumeCum * 35.3147); // cum to cft
  const aggVolumeCft = Math.ceil((aggParts / totalParts) * dryVolumeCum * 35.3147);

  // 3. Paint calculations
  const grossWallArea = wallPerimeter * wallHeight;
  const doorArea = doorsCount * 21; // standard door ~21 sq.ft
  const windowArea = windowsCount * 15; // standard window ~15 sq.ft
  const netWallArea = Math.max(0, grossWallArea - doorArea - windowArea);
  const totalPaintArea = netWallArea * paintCoats;
  // 1 Gallon of paint covers ~350-400 sq.ft
  const paintGallons = paintCoverage > 0 ? Math.ceil(totalPaintArea / paintCoverage) : 0;
  const paintLiters = Math.ceil(paintGallons * 3.78541); // gallons to liters

  // 4a. Brick calculations
  const wallVolumeCft = wallL * wallH * (wallT / 12);
  // Volume of brick with mortar (standard brick 9 x 4.5 x 3 inches + 0.5 inch mortar)
  const brickVolumeWithMortarCft = ((brickL + 0.5) * (brickW + 0.5) * (brickH + 0.5)) / 1728;
  const bricksCount = brickVolumeWithMortarCft > 0 ? Math.ceil(wallVolumeCft / brickVolumeWithMortarCft) : 0;
  // Mortar is roughly 30% of wall volume
  const mortarVolumeCft = wallVolumeCft * 0.3;
  // 1 bag of cement + 3 cft sand covers ~10 cft mortar
  const brickCementBags = Math.ceil(mortarVolumeCft / 10);
  const brickSandCft = Math.ceil(brickCementBags * 3);

  // 4b. Steel weight (Standard formula: weight per meter = D^2 / 162.2)
  const steelLengthMeters = steelLength * 0.3048; // feet to meters
  const steelWeightKg = ((steelDiameter * steelDiameter) / 162.2) * steelLengthMeters;

  // 4c. Timber volume
  const singleTimberCft = (timberL * (timberW / 12) * (timberH / 12));
  const totalTimberCft = singleTimberCft * timberQty;
  const timberTotalCost = totalTimberCft * timberPriceCft;

  // 5. Business calculations
  const discountVal = basePrice * (discountPct / 100);
  const priceAfterDiscount = basePrice - discountVal;
  const vatVal = priceAfterDiscount * (vatPct / 100);
  const totalInvoicePrice = priceAfterDiscount + vatVal;

  const costFromMargin = costPrice / (1 - marginPct / 100);
  const costFromMarkup = costPrice * (1 + markupPct / 100);

  // EOQ Formula: sqrt(2 * Demand * OrderingCost / HoldingCost)
  const eoq = holdingCost > 0 ? Math.ceil(Math.sqrt((2 * annualDemand * orderingCost) / holdingCost)) : 0;
  // Reorder Level = (Average Daily Demand * Lead Time) + Safety Stock
  const dailyDemand = annualDemand / 365;
  const avgSafetyStock = Math.ceil(dailyDemand * 3); // 3 days safety stock simulation
  const reorderPoint = Math.ceil((dailyDemand * leadTimeDays) + avgSafetyStock);

  return (
    <div className="w-full min-w-0 space-y-4 text-slate-800">
      <nav aria-label="Calculator categories" className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <button
          aria-pressed={subTab === 'tile'}
          onClick={() => setSubTab('tile')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
            subTab === 'tile' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200/80'
          }`}
        >
          <Layers className="w-4 h-4" />
          Tiles
        </button>
        <button
          aria-pressed={subTab === 'concrete'}
          onClick={() => setSubTab('concrete')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
            subTab === 'concrete' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200/80'
          }`}
        >
          <Hammer className="w-4 h-4" />
          Cement & Concrete
        </button>
        <button
          aria-pressed={subTab === 'paint'}
          onClick={() => setSubTab('paint')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
            subTab === 'paint' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200/80'
          }`}
        >
          <Paintbrush className="w-4 h-4" />
          Paint
        </button>
        <button
          aria-pressed={subTab === 'brick-steel-timber'}
          onClick={() => setSubTab('brick-steel-timber')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
            subTab === 'brick-steel-timber' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200/80'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          Bricks, Steel & Timber
        </button>
        <button
          aria-pressed={subTab === 'business'}
          onClick={() => setSubTab('business')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
            subTab === 'business' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200/80'
          }`}
        >
          <BadgePercent className="w-4 h-4" />
          Business & Inventory
        </button>
      </nav>

      {subTab === 'tile' && (
        <section aria-label="Tile order estimate" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <h2 className="text-lg font-bold">{boxesRequired} boxes · {boxesRequired * tilesPerBox} tiles</h2>
            <p className="text-sm text-slate-700">{priceReady
              ? `${taxConfig.currency} ${tileTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} before tax and transport`
              : 'Select the stock unit to calculate the price.'}</p>
            {product && stockUnit && <p className="mt-1 text-sm">
              {product.wholesalePrice ? 'Wholesale price' : 'Selling price'} · {product.quantity} {stockUnit === 'box' ? 'boxes' : 'tiles'} in stock · {Math.max(0, stockNeeded - product.quantity)} short
            </p>}
          </div>
          {onQuote && product && stockUnit && (
            <button type="button" disabled={!Number.isSafeInteger(stockNeeded) || stockNeeded < 1 || stockNeeded > 1e9 || !Number.isFinite(tileTotalCost) || tileTotalCost > 9e9}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => onQuote({
                item: { productId: product.id, productName: product.name, quantity: stockNeeded, sellingPrice: unitPrice ?? 0, discount: 0 },
                notes: `Tile estimate. Quantity and unit price are per ${stockUnit}. Pack size: ${tilesPerBox} tiles per box.`,
              })}>Add to quotation</button>
          )}
        </section>
      )}

      {/* Calculator Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">

        {/* Inputs (Left Panel) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-xl">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">Estimate inputs</h2>

          {/* TILE CALCULATOR INPUTS */}
          {subTab === 'tile' && (
            <>
              <label className="block space-y-1 text-xs text-slate-300">
                <span>Stock product</span>
                <select className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  value={product?.id ?? ''} onChange={event => { setProductId(event.target.value); setStockUnit(''); }}>
                  <option value="">Manual estimate</option>
                  {catalog.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.sku}</option>)}
                </select>
              </label>
              {product && (
                <label className="block space-y-1 text-xs text-slate-300">
                  <span>How is this product counted in stock?</span>
                  <select className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                    value={stockUnit} onChange={event => setStockUnit(event.target.value as typeof stockUnit)}>
                    <option value="">Select the stock unit</option>
                    <option value="box">One stock unit is one box</option>
                    <option value="tile">One stock unit is one tile</option>
                  </select>
                </label>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Room Length (ft)</label>
                  <input
                    type="number"
                    value={roomLength}
                    onChange={(e) => setRoomLength(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Room Width (ft)</label>
                  <input
                    type="number"
                    value={roomWidth}
                    onChange={(e) => setRoomWidth(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300">Tile Size Presets</label>
                <select
                  value={tileSizePreset}
                  onChange={(e) => setTileSizePreset(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="1x1">1×1 ft</option>
                  <option value="2x2">2×2 ft (Standard)</option>
                  <option value="2x4">2×4 ft</option>
                  <option value="4x2">4×2 ft</option>
                  <option value="12x24">12×24 in</option>
                  <option value="24x24">24×24 in</option>
                  <option value="custom">Custom Dimensions</option>
                </select>
              </div>

              {tileSizePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-300">Tile Length (ft)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={customTileLength}
                      onChange={(e) => setCustomTileLength(Math.max(0.1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-300">Tile Width (ft)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={customTileWidth}
                      onChange={(e) => setCustomTileWidth(Math.max(0.1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Tiles Per Box</label>
                  <input
                    type="number"
                    value={tilesPerBox}
                    onChange={(e) => setTilesPerBox(Math.max(1, Math.floor(Number(e.target.value))))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Waste Factor (%)</label>
                  <input
                    type="number"
                    value={tileWaste}
                    onChange={(e) => setTileWaste(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Price Per Box ({taxConfig.currency})</label>
                  <input
                    type="number"
                    value={priceReady ? pricePerBox : ''}
                    readOnly={!!product}
                    onChange={(e) => setPricePerBox(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Deduction (Doors/Pillars) (sq.ft)</label>
                  <input
                    type="number"
                    value={tileDeductions}
                    onChange={(e) => setTileDeductions(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                    placeholder="e.g. 21"
                  />
                </div>
              </div>
            </>
          )}

          {/* CONCRETE CALCULATOR INPUTS */}
          {subTab === 'concrete' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Slab Length (ft)</label>
                  <input
                    type="number"
                    value={slabLength}
                    onChange={(e) => setSlabLength(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Slab Width (ft)</label>
                  <input
                    type="number"
                    value={slabWidth}
                    onChange={(e) => setSlabWidth(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300">Slab Thickness (inches)</label>
                <input
                  type="number"
                  value={slabThickness}
                  onChange={(e) => setSlabThickness(Math.max(1, Number(e.target.value)))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300">Concrete Proportions Mix</label>
                <select
                  value={concreteRatio}
                  onChange={(e) => setConcreteRatio(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="1:2:4">1:2:4 (M15 - Foundations & Slabs)</option>
                  <option value="1:1.5:3">1:1.5:3 (M20 - RCC Beams & Columns)</option>
                  <option value="1:3:6">1:3:6 (M10 - Plain Cement Concrete)</option>
                </select>
              </div>
            </>
          )}

          {/* PAINT CALCULATOR INPUTS */}
          {subTab === 'paint' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Wall Perimeter (total length in ft)</label>
                  <input
                    type="number"
                    value={wallPerimeter}
                    onChange={(e) => setWallPerimeter(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Wall Height (ft)</label>
                  <input
                    type="number"
                    value={wallHeight}
                    onChange={(e) => setWallHeight(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Number of Doors</label>
                  <input
                    type="number"
                    value={doorsCount}
                    onChange={(e) => setDoorsCount(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Number of Windows</label>
                  <input
                    type="number"
                    value={windowsCount}
                    onChange={(e) => setWindowsCount(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Number of Coats</label>
                  <input
                    type="number"
                    value={paintCoats}
                    onChange={(e) => setPaintCoats(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Coverage (sq.ft/gal)</label>
                  <input
                    type="number"
                    value={paintCoverage}
                    onChange={(e) => setPaintCoverage(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </>
          )}

          {/* BRICKS, STEEL & TIMBER INPUTS */}
          {subTab === 'brick-steel-timber' && (
            <div className="space-y-6">
              {/* Bricks Section */}
              <div className="space-y-2 border-b border-slate-800 pb-4">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Wall & Brick Dimensions</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Wall Length (ft)</label>
                    <input
                      type="number"
                      value={wallL}
                      onChange={(e) => setWallL(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Wall Height (ft)</label>
                    <input
                      type="number"
                      value={wallH}
                      onChange={(e) => setWallH(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Thickness (in)</label>
                    <select
                      value={wallT}
                      onChange={(e) => setWallT(Number(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value={4.5}>4.5 in (Single)</option>
                      <option value={9}>9 in (Double)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Steel Section */}
              <div className="space-y-2 border-b border-slate-800 pb-4">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Steel Bar Specification</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Diameter (mm)</label>
                    <input
                      type="number"
                      value={steelDiameter}
                      onChange={(e) => setSteelDiameter(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Total Length (ft)</label>
                    <input
                      type="number"
                      value={steelLength}
                      onChange={(e) => setSteelLength(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Timber Section */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Timber / Planks Estimation</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Length (ft)</label>
                    <input
                      type="number"
                      value={timberL}
                      onChange={(e) => setTimberL(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Width (in)</label>
                    <input
                      type="number"
                      value={timberW}
                      onChange={(e) => setTimberW(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Thickness (in)</label>
                    <input
                      type="number"
                      value={timberH}
                      onChange={(e) => setTimberH(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Quantity</label>
                    <input
                      type="number"
                      value={timberQty}
                      onChange={(e) => setTimberQty(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Price / CFT</label>
                    <input
                      type="number"
                      value={timberPriceCft}
                      onChange={(e) => setTimberPriceCft(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* BUSINESS CALCULATOR INPUTS */}
          {subTab === 'business' && (
            <div className="space-y-6">
              {/* Discount/VAT */}
              <div className="space-y-2 border-b border-slate-800 pb-4">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Retail Price, Discount & Tax</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Base Price</label>
                    <input
                      type="number"
                      value={basePrice}
                      onChange={(e) => setBasePrice(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Discount (%)</label>
                    <input
                      type="number"
                      value={discountPct}
                      onChange={(e) => setDiscountPct(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">VAT (%)</label>
                    <input
                      type="number"
                      value={vatPct}
                      onChange={(e) => setVatPct(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Margins */}
              <div className="space-y-2 border-b border-slate-800 pb-4">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Margins & Markup</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Cost Price</label>
                    <input
                      type="number"
                      value={costPrice}
                      onChange={(e) => setCostPrice(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Margin (%)</label>
                    <input
                      type="number"
                      value={marginPct}
                      onChange={(e) => setMarginPct(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Markup (%)</label>
                    <input
                      type="number"
                      value={markupPct}
                      onChange={(e) => setMarkupPct(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* EOQ and Safety stock */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">EOQ & Safety Stock Metrics</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Annual Demand (units)</label>
                    <input
                      type="number"
                      value={annualDemand}
                      onChange={(e) => setAnnualDemand(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Ordering Cost (per order)</label>
                    <input
                      type="number"
                      value={orderingCost}
                      onChange={(e) => setOrderingCost(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Holding Cost (unit/yr)</label>
                    <input
                      type="number"
                      value={holdingCost}
                      onChange={(e) => setHoldingCost(Math.max(0.1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">Lead Time (days)</label>
                    <input
                      type="number"
                      value={leadTimeDays}
                      onChange={(e) => setLeadTimeDays(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Output Results (Right Panel) */}
        <div className="lg:col-span-7 space-y-6">

          {/* Results Summary Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                <Coins className="w-5 h-5 text-indigo-400" />
                Calculation Estimates
              </h3>

            </div>

            {/* TILE CALCULATOR RESULTS */}
            {subTab === 'tile' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Room Area (Gross / Tiled)</p>
                  <p className="text-xl font-bold text-slate-100">{rawRoomArea} sq.ft / {roomArea} sq.ft</p>
                  {tileDeductions > 0 && <p className="text-[10px] text-rose-400 font-medium">- {tileDeductions} sq.ft deduction applied</p>}
                </div>
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Tile Area Size</p>
                  <p className="text-xl font-bold text-slate-100">{tileArea.toFixed(2)} sq.ft</p>
                </div>
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Net Tiles Required</p>
                  <p className="text-xl font-bold text-slate-100">{netTiles} pieces</p>
                </div>
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Waste Allocation ({tileWaste}%)</p>
                  <p className="text-xl font-bold text-amber-400">+{tileWasteQty} pieces</p>
                </div>
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Adhesive / Thinset Bags</p>
                  <p className="text-lg font-bold text-slate-200">~{adhesiveBags} Bags (25kg)</p>
                </div>
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Grout Powder</p>
                  <p className="text-lg font-bold text-slate-200">~{groutKg} kg</p>
                </div>
                <div className="md:col-span-2 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400">Whole tiles left after waste allowance</p>
                    <p className="text-sm font-semibold text-slate-300">{remainingStock} tile pieces</p>
                  </div>
                  <span className="text-xs bg-slate-700/50 text-slate-400 px-2 py-1 rounded">Spare pieces</span>
                </div>
              </div>
            )}

            {/* CONCRETE CALCULATOR RESULTS */}
            {subTab === 'concrete' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Wet Concrete Volume</p>
                  <p className="text-lg font-bold text-slate-200">{slabVolumeCft.toFixed(2)} cu.ft ({slabVolumeCum.toFixed(2)} m³)</p>
                </div>
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Dry Volume (x1.54 shrink factor)</p>
                  <p className="text-lg font-bold text-slate-200">{dryVolumeCum.toFixed(2)} m³</p>
                </div>
                <div className="space-y-1 p-3 bg-indigo-500/5 rounded-lg border border-indigo-500/20 md:col-span-2">
                  <p className="text-xs text-indigo-400 font-semibold uppercase tracking-wider">Required Materials List</p>
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-between border-b border-slate-800 pb-1 text-sm">
                      <span className="text-slate-300">1. Cement Bags (50kg)</span>
                      <span className="font-bold text-indigo-300">{cementBags} Bags</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1 text-sm">
                      <span className="text-slate-300">2. Dry Fine Sand</span>
                      <span className="font-bold text-indigo-300">{sandVolumeCft} cu.ft</span>
                    </div>
                    <div className="flex justify-between pb-1 text-sm">
                      <span className="text-slate-300">3. Coarse Aggregate (Stone Gravel)</span>
                      <span className="font-bold text-indigo-300">{aggVolumeCft} cu.ft</span>
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2 p-3.5 bg-amber-500/5 rounded-lg border border-amber-500/20 flex items-start gap-2.5">
                  <ShieldAlert className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-400/90 leading-relaxed">
                    <strong>Notice:</strong> Computations assume a standard concrete mix density. Actual yield may vary slightly depending on water content, sand moisture percentage, and aggregate porosity.
                  </p>
                </div>
              </div>
            )}

            {/* PAINT CALCULATOR RESULTS */}
            {subTab === 'paint' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Total Wall Surface Area</p>
                  <p className="text-lg font-bold text-slate-200">{grossWallArea} sq.ft</p>
                </div>
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Deductions (Doors & Windows)</p>
                  <p className="text-lg font-bold text-rose-400">-{doorArea + windowArea} sq.ft</p>
                </div>
                <div className="space-y-1 p-3 bg-slate-800/40 rounded-lg border border-slate-800/80">
                  <p className="text-xs text-slate-400">Net Painting Area ({paintCoats} Coats)</p>
                  <p className="text-lg font-bold text-slate-200">{totalPaintArea} sq.ft</p>
                </div>
                <div className="space-y-1 p-3 bg-indigo-500/5 rounded-lg border border-indigo-500/20">
                  <p className="text-xs text-indigo-400 font-semibold">Total Paint Required</p>
                  <p className="text-2xl font-black text-indigo-300">~{paintLiters} Liters</p>
                  <p className="text-[10px] text-slate-400 font-mono mt-1">({paintGallons} Gallons)</p>
                </div>
              </div>
            )}

            {/* BRICKS, STEEL & TIMBER RESULTS */}
            {subTab === 'brick-steel-timber' && (
              <div className="space-y-4">
                {/* Bricks results */}
                <div className="p-4 bg-slate-800/30 border border-slate-800 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Brick Masonry Estimate</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    <div className="p-2 bg-slate-800 rounded">
                      <p className="text-[10px] text-slate-500">Wall Volume</p>
                      <p className="text-sm font-bold">{wallVolumeCft.toFixed(1)} cft</p>
                    </div>
                    <div className="p-2 bg-slate-800 rounded">
                      <p className="text-[10px] text-slate-500">Bricks Required</p>
                      <p className="text-sm font-bold text-indigo-300">{bricksCount}</p>
                    </div>
                    <div className="p-2 bg-slate-800 rounded">
                      <p className="text-[10px] text-slate-500">Cement (Mortar)</p>
                      <p className="text-sm font-bold text-indigo-300">{brickCementBags} Bags</p>
                    </div>
                    <div className="p-2 bg-slate-800 rounded">
                      <p className="text-[10px] text-slate-500">Sand (Mortar)</p>
                      <p className="text-sm font-bold text-indigo-300">{brickSandCft} cft</p>
                    </div>
                  </div>
                </div>

                {/* Steel results */}
                <div className="p-4 bg-slate-800/30 border border-slate-800 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Rebar Steel Weight Estimate</h4>
                  <div className="flex justify-between items-center bg-slate-800 p-3 rounded">
                    <div>
                      <p className="text-xs text-slate-400">Rod Diameter: <strong>{steelDiameter} mm</strong></p>
                      <p className="text-xs text-slate-400">Length: <strong>{steelLength} ft</strong> ({steelLengthMeters.toFixed(1)} m)</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500">Calculated Weight</p>
                      <p className="text-lg font-black text-indigo-300">{steelWeightKg.toFixed(2)} kg</p>
                    </div>
                  </div>
                </div>

                {/* Timber results */}
                <div className="p-4 bg-slate-800/30 border border-slate-800 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Timber Volume & Cost</h4>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-slate-800 rounded">
                      <p className="text-[10px] text-slate-500">Volume / Unit</p>
                      <p className="text-xs font-bold">{singleTimberCft.toFixed(2)} cft</p>
                    </div>
                    <div className="p-2 bg-slate-800 rounded">
                      <p className="text-[10px] text-slate-500">Total Volume</p>
                      <p className="text-xs font-bold text-indigo-300">{totalTimberCft.toFixed(2)} cft</p>
                    </div>
                    <div className="p-2 bg-slate-800 rounded">
                      <p className="text-[10px] text-slate-500">Total Cost</p>
                      <p className="text-xs font-bold text-indigo-300">{taxConfig.currency} {timberTotalCost.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* BUSINESS CALCULATOR RESULTS */}
            {subTab === 'business' && (
              <div className="space-y-4">
                {/* Discount/VAT */}
                <div className="p-4 bg-slate-800/30 border border-slate-800 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">VAT & Discount Calculation</h4>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 bg-slate-800 rounded">
                      <span className="text-slate-500 block">Net Price</span>
                      <strong className="text-slate-300">Rs.{priceAfterDiscount.toFixed(2)}</strong>
                    </div>
                    <div className="p-2 bg-slate-800 rounded">
                      <span className="text-slate-500 block">VAT Amount</span>
                      <strong className="text-slate-300">Rs.{vatVal.toFixed(2)}</strong>
                    </div>
                    <div className="p-2 bg-slate-800 rounded">
                      <span className="text-slate-500 block">Total Due</span>
                      <strong className="text-indigo-300">Rs.{totalInvoicePrice.toFixed(2)}</strong>
                    </div>
                  </div>
                </div>

                {/* Margins */}
                <div className="p-4 bg-slate-800/30 border border-slate-800 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Profit Margins comparison</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-slate-800 rounded">
                      <span className="text-slate-500 block">Selling Price from Margin ({marginPct}%)</span>
                      <strong className="text-sm text-indigo-300">Rs.{costFromMargin.toFixed(2)}</strong>
                      <span className="text-[9px] text-slate-500 block mt-1">Profit: Rs.{(costFromMargin - costPrice).toFixed(2)}</span>
                    </div>
                    <div className="p-3 bg-slate-800 rounded">
                      <span className="text-slate-500 block">Selling Price from Markup ({markupPct}%)</span>
                      <strong className="text-sm text-indigo-300">Rs.{costFromMarkup.toFixed(2)}</strong>
                      <span className="text-[9px] text-slate-500 block mt-1">Profit: Rs.{(costFromMarkup - costPrice).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* EOQ */}
                <div className="p-4 bg-slate-800/30 border border-slate-800 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Inventory optimization indices</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 bg-slate-800 rounded flex justify-between items-center">
                      <div>
                        <span className="text-slate-500 block">Economic Order Quantity (EOQ)</span>
                        <span className="text-[9px] text-slate-500 font-mono">Replenishment optimization size</span>
                      </div>
                      <strong className="text-lg text-indigo-300 font-black">{eoq} Units</strong>
                    </div>
                    <div className="p-2.5 bg-slate-800 rounded flex justify-between items-center">
                      <div>
                        <span className="text-slate-500 block">Suggested Reorder Level</span>
                        <span className="text-[9px] text-slate-500 font-mono">Lead time safety (inc. {avgSafetyStock} ss)</span>
                      </div>
                      <strong className="text-lg text-indigo-300 font-black">{reorderPoint} Units</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>



        </div>
      </div>
    </div>
  );
}
