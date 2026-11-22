import React, { useState, useRef } from 'react';
import { X, Upload, QrCode, Camera, AlertCircle, CheckCircle } from 'lucide-react';
import jsQR from 'jsqr';
import { Product } from '../types';

interface QRFeatureViewProps {
  onClose: () => void;
  onProductFound: (product: Product) => void;
  products: Product[];
  authToken: string;
  userRole?: string;
}

export const QRFeatureView: React.FC<QRFeatureViewProps> = ({
  onClose,
  onProductFound,
  products,
  authToken,
  userRole = 'Cashier',
}) => {
  const [mode, setMode] = useState<'scan' | 'upload' | 'manual'>('scan');
  const [manualCode, setManualCode] = useState('');
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; product?: Product } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = userRole === 'Super Admin' || userRole === 'Store Manager';

  const authFetch = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${authToken}`);
    if (!headers.has('Content-Type') && init?.body) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...init, headers });
  };

  const decodeQRFromFile = async (file: File): Promise<string | null> => {
    const imageBitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const decoded = jsQR(imageData.data, imageData.width, imageData.height);
    return decoded?.data || null;
  };

  const performQRScan = async (qrData: string) => {
    setIsLoading(true);
    setResult(null);

    try {
      const response = await authFetch('/api/qr/scan', {
        method: 'POST',
        body: JSON.stringify({ qrData: qrData.trim() }),
      });

      if (response.ok) {
        const { product } = await response.json();
        setResult({ type: 'success', message: `Found: ${product.name}`, product });
        setTimeout(() => {
          onProductFound(product);
          onClose();
        }, 800);
      } else {
        const { error } = await response.json();
        setResult({ type: 'error', message: error || 'Product not found' });
      }
    } catch (err) {
      setResult({ type: 'error', message: 'Scan failed: ' + String(err) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    setIsLoading(true);
    setResult(null);
    try {
      const decodedText = await decodeQRFromFile(file);
      if (!decodedText) {
        setResult({ type: 'error', message: 'No QR code found in camera image.' });
        return;
      }
      await performQRScan(decodedText);
    } catch (err) {
      setResult({ type: 'error', message: 'Camera scan failed: ' + String(err) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setResult(null);

    try {
      const decodedText = await decodeQRFromFile(file);
      if (!decodedText) {
        setResult({ type: 'error', message: 'No QR code found in uploaded image.' });
        return;
      }
      await performQRScan(decodedText);
    } catch (err) {
      setResult({ type: 'error', message: 'File upload failed: ' + String(err) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualSubmit = async () => {
    if (!manualCode.trim()) {
      setResult({ type: 'error', message: 'Please enter a product code' });
      return;
    }
    await performQRScan(manualCode);
    setManualCode('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <QrCode className="w-5 h-5 text-indigo-600" />
            QR Product Lookup
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Mode Selector */}
          <div className="flex gap-2 border-b border-slate-200">
            <button
              onClick={() => setMode('scan')}
              className={`flex-1 py-2 px-3 text-xs font-semibold border-b-2 transition ${
                mode === 'scan'
                  ? 'text-indigo-600 border-indigo-600'
                  : 'text-slate-500 border-transparent hover:text-slate-700'
              }`}
            >
              Manual Entry
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => setMode('upload')}
                  className={`flex-1 py-2 px-3 text-xs font-semibold border-b-2 transition ${
                    mode === 'upload'
                      ? 'text-indigo-600 border-indigo-600'
                      : 'text-slate-500 border-transparent hover:text-slate-700'
                  }`}
                >
                  Upload QR
                </button>
                <button
                  onClick={() => setMode('manual')}
                  className={`flex-1 py-2 px-3 text-xs font-semibold border-b-2 transition ${
                    mode === 'manual'
                      ? 'text-indigo-600 border-indigo-600'
                      : 'text-slate-500 border-transparent hover:text-slate-700'
                  }`}
                >
                  Camera
                </button>
              </>
            )}
          </div>

          {/* Manual Entry Mode */}
          {mode === 'scan' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">
                  Enter Internal Code, SKU, or Barcode
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                    placeholder="e.g., YMV, TSK, CON-CEM-001..."
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleManualSubmit}
                    disabled={isLoading || !manualCode.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {isLoading ? 'Searching...' : 'Search'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                  Search works with internal codes (admin only), SKU, or product barcode.
                </p>
              </div>
            </div>
          )}

          {/* Upload QR Mode (Admin Only) */}
          {mode === 'upload' && isAdmin && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition"
              >
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-600">Upload QR Code Image</p>
                <p className="text-xs text-slate-500 mt-1">PNG, JPG up to 5MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </div>
          )}

          {/* Camera Mode (Admin Only) */}
          {mode === 'manual' && isAdmin && (
            <div className="space-y-4">
              <div
                onClick={() => cameraInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition"
              >
                <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-600">Use Camera</p>
                <p className="text-xs text-slate-500 mt-1">Scan QR codes with your device camera</p>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleCameraCapture}
                  className="hidden"
                />
              </div>
            </div>
          )}

          {/* Result Message */}
          {result && (
            <div
              className={`p-4 rounded-lg flex items-start gap-3 ${
                result.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200'
                  : 'bg-rose-50 border border-rose-200'
              }`}
            >
              {result.type === 'success' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div>
                <p
                  className={`text-sm font-semibold ${
                    result.type === 'success' ? 'text-emerald-900' : 'text-rose-900'
                  }`}
                >
                  {result.message}
                </p>
                {result.product && (
                  <p className="text-xs text-emerald-700 mt-1">
                    Price: Rs.{result.product.sellingPrice.toFixed(2)} | Stock: {result.product.quantity}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Product Quick Reference (Admin View) */}
          {isAdmin && products.length > 0 && (
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-xs font-semibold text-slate-600 mb-2">Internal Codes (Admin Only):</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {products
                  .filter((p) => p.internalCode)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="text-[10px] font-mono text-slate-600 flex justify-between"
                    >
                      <span className="font-bold text-indigo-600">{p.internalCode}</span>
                      <span>{p.name.substring(0, 20)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 p-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-semibold hover:bg-slate-50 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
