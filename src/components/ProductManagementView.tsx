import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { notify } from '../utils/notifications';
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  Filter,
  Package,
  MapPin,
  Barcode,
  HelpCircle,
  X,
  AlertTriangle,
  Layers,
  PlusCircle,
} from 'lucide-react';
import { Product, ProductVariant, Role } from '../types';
import { previewLegacyPackaging } from '../utils/legacyPackagingConversion';
import { validateSharedStock, type SharedStockUnits } from '../utils/unitConversion';
import { sanitizeImageSrc } from '../utils/sanitizeImageSrc';

interface ProductManagementViewProps {
  products: Product[];
  currentRole: Role;
  taxConfig?: { taxRate: number; storeName: string; currency: string; invoicePrefix: string; productCategories?: string[] };
  authToken: string;
  onAddProduct: (prodData: Omit<Product, 'id'>) => Promise<Product>;
  onEditProduct: (id: string, prodData: Partial<Product> & { reason?: string; user?: string }) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  onAddCategory: (categoryName: string) => Promise<void>;
}

export default function ProductManagementView({
  products,
  currentRole,
  taxConfig,
  authToken,
  onAddProduct,
  onEditProduct,
  onDeleteProduct,
  onAddCategory,
}: ProductManagementViewProps) {
  const currencySymbol = 'Rs.';
  const unitOptions = ['Piece', 'Liter', 'Milliliter', 'Kilogram', 'Gram', 'Meter', 'Feet', 'Roll', 'Box', 'Bag', 'Pack', 'Set', 'Square Feet', 'Square Meter'];
  const defaultCategories = [
    'Adhesives & Sealants',
    'Abrasives',
    'Automotive & Lubricants',
    'Bath & Sanitaryware',
    'Cleaning Supplies',
    'Construction Materials',
    'Doors & Windows',
    'Plumbing',
    'Electrical',
    'Fasteners',
    'Flooring & Tiles',
    'Garden & Irrigation',
    'General Hardware',
    'Hand Tools',
    'Kitchen Hardware',
    'Ladders & Access Equipment',
    'Locks & Hinges',
    'Machinery & Equipment',
    'Measuring & Marking',
    'Tools',
    'Paints',
    'Power Tools',
    'Roofing & Gutters',
    'Safety Equipment',
    'Steel & Metal',
    'Storage & Shelving',
    'Timber & Boards',
    'Welding Supplies',
  ];

  const categoryAttributeTemplates: Array<{ match: string[]; fields: string[] }> = [
    {
      match: ['adhesive', 'sealant', 'silicone', 'glue', 'caulk', 'epoxy'],
      fields: ['Type', 'Base Material', 'Color', 'Pack Size', 'Cure Time', 'Application Surface'],
    },
    {
      match: ['abrasive', 'sandpaper', 'grinding', 'cutting disc', 'disc', 'wheel'],
      fields: ['Abrasive Type', 'Grit', 'Diameter', 'Thickness', 'Material Use', 'Pack Quantity'],
    },
    {
      match: ['automotive', 'lubricant', 'oil', 'grease', 'coolant'],
      fields: ['Fluid Type', 'Viscosity/Grade', 'Volume', 'Vehicle Use', 'Standard', 'Brand Series'],
    },
    {
      match: ['bath', 'sanitary', 'toilet', 'basin', 'shower', 'tap', 'faucet'],
      fields: ['Fixture Type', 'Material', 'Finish', 'Size', 'Mount Type', 'Water Rating'],
    },
    {
      match: ['cleaning', 'cleaner', 'mop', 'brush', 'detergent'],
      fields: ['Product Type', 'Volume/Size', 'Surface Use', 'Scent', 'Pack Quantity'],
    },
    {
      match: ['door', 'window', 'frame', 'glass'],
      fields: ['Item Type', 'Material', 'Size', 'Finish', 'Opening Direction', 'Glass/Panel Type'],
    },
    {
      match: ['fastener', 'nail', 'screw', 'bolt', 'nut', 'washer', 'anchor', 'rivet'],
      fields: ['Fastener Type', 'Size', 'Length', 'Thread Type', 'Material', 'Finish', 'Pack Quantity'],
    },
    {
      match: ['flooring', 'tile', 'tiles', 'granite', 'marble', 'vinyl'],
      fields: ['Material', 'Size', 'Finish', 'Color', 'Thickness', 'Coverage Area'],
    },
    {
      match: ['garden', 'irrigation', 'hose', 'sprinkler'],
      fields: ['Item Type', 'Size', 'Length', 'Material', 'Coverage', 'Connection Size'],
    },
    {
      match: ['general hardware', 'hardware'],
      fields: ['Item Type', 'Material', 'Size', 'Finish', 'Pack Quantity'],
    },
    {
      match: ['hand tool', 'hammer', 'spanner', 'wrench', 'pliers', 'saw', 'chisel', 'screwdriver'],
      fields: ['Tool Type', 'Size', 'Material', 'Handle Type', 'Duty Rating', 'Set Pieces'],
    },
    {
      match: ['kitchen'],
      fields: ['Item Type', 'Material', 'Finish', 'Size', 'Mount Type'],
    },
    {
      match: ['ladder', 'access equipment', 'scaffold'],
      fields: ['Equipment Type', 'Height', 'Load Capacity', 'Material', 'Steps/Sections', 'Safety Standard'],
    },
    {
      match: ['lock', 'hinge', 'hasp', 'latch', 'handle', 'knob'],
      fields: ['Hardware Type', 'Size', 'Material', 'Finish', 'Door Thickness', 'Key Type'],
    },
    {
      match: ['machinery', 'equipment', 'compressor', 'generator', 'pump', 'motor'],
      fields: ['Equipment Type', 'Power', 'Voltage', 'Capacity', 'Fuel/Power Source', 'Warranty'],
    },
    {
      match: ['measuring', 'marking', 'level', 'tape', 'laser'],
      fields: ['Tool Type', 'Measuring Range', 'Accuracy', 'Unit', 'Material'],
    },
    {
      match: ['paint', 'paints'],
      fields: ['Volume', 'Color', 'Finish', 'Base Type', 'Coverage'],
    },
    {
      match: ['power tool', 'drill', 'grinder', 'cutter', 'sander', 'blower'],
      fields: ['Tool Type', 'Power Source', 'Voltage', 'Wattage', 'Chuck/Disc Size', 'Speed', 'Warranty'],
    },
    {
      match: ['roofing', 'gutter', 'sheet', 'ceiling'],
      fields: ['Material', 'Profile', 'Length', 'Width', 'Thickness', 'Color/Coating'],
    },
    {
      match: ['safety', 'ppe', 'helmet', 'glove', 'goggle', 'mask', 'boot'],
      fields: ['PPE Type', 'Size', 'Material', 'Color', 'Certification', 'Standard'],
    },
    {
      match: ['steel', 'metal', 'iron', 'bar', 'rod', 'angle', 'pipe section'],
      fields: ['Metal Type', 'Profile', 'Size', 'Length', 'Thickness/Gauge', 'Grade'],
    },
    {
      match: ['storage', 'shelving', 'rack', 'cabinet', 'tool box'],
      fields: ['Storage Type', 'Material', 'Size', 'Load Capacity', 'Compartments'],
    },
    {
      match: ['timber', 'wood', 'board', 'plywood', 'mdf'],
      fields: ['Wood Type', 'Grade', 'Length', 'Width', 'Thickness', 'Treatment'],
    },
    {
      match: ['welding', 'electrode', 'solder', 'brazing'],
      fields: ['Welding Type', 'Diameter', 'Material', 'Current Range', 'Pack Weight', 'Standard'],
    },
    {
      match: ['electrical', 'light', 'lighting', 'wire', 'cable', 'switch', 'socket', 'breaker'],
      fields: ['Electrical Type', 'Wattage/Rating', 'Voltage', 'Current Rating', 'Color Temperature', 'Wire Size', 'IP Rating'],
    },
    {
      match: ['plumbing', 'pipe', 'valve', 'fitting'],
      fields: ['Plumbing Type', 'Diameter', 'Length', 'Material', 'Pressure Rating', 'Thread Type'],
    },
    {
      match: ['construction', 'cement', 'brick', 'block', 'sand', 'aggregate', 'concrete'],
      fields: ['Material Type', 'Grade', 'Size', 'Weight', 'Strength Class', 'Coverage/Yield'],
    },
    {
      match: ['tools', 'tool'],
      fields: ['Power Source', 'Model', 'Size', 'Material', 'Duty Rating'],
    },
  ];

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Form Modal States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showAdvancedProduct, setShowAdvancedProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [internalCode, setInternalCode] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [costPrice, setCostPrice] = useState(0);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [quantity, setQuantity] = useState(0);
  const [reorderLevel, setReorderLevel] = useState(10);
  const [warranty, setWarranty] = useState('No Warranty');
  const [description, setDescription] = useState('');
  const [longDescription, setLongDescription] = useState('');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  const [location, setLocation] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCategorySubmitting, setIsCategorySubmitting] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  // Show a clear warning before staff accidentally register the same item
  // under another automatically generated product code.
  const matchingProducts = name.trim().length >= 3
    ? products.filter((product) =>
        product.id !== editingProduct?.id
        && product.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
      ).slice(0, 3)
    : [];


  const [simpleProductAttributes, setSimpleProductAttributes] = useState<Record<string, string>>({});

  const setSimpleProductAttributeValue = (key: string, value: string) => {
    setSimpleProductAttributes((current) => ({ ...current, [key]: value }));
  };

  const authFetch = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${authToken}`);
    return fetch(url, { ...init, headers });
  };

  const [newProductMultipleUnits,setNewProductMultipleUnits]=useState(false);
  const [packagingProduct, setPackagingProduct] = useState<Product | null>(null);
  const [packaging, setPackaging] = useState<SharedStockUnits>({baseUnit:'Piece', units:[]});
  const [legacyUnitId,setLegacyUnitId]=useState('');
  const [historyLines,setHistoryLines]=useState<Array<{saleItemId:string;invoiceNumber:string;date:string;status:string;quantity:number;sellingPrice:number;originalUnit:string|null;variantId:string|null;hasSharedSnapshot:boolean}>|null>(null);
  const [historyUnits,setHistoryUnits]=useState<Record<string,string>>({});
  const historyComplete=historyLines!==null && historyLines.every(line=>!line.variantId&&!line.hasSharedSnapshot&&packaging.units.some(u=>u.id===historyUnits[line.saleItemId]));
  const [packagingBusy, setPackagingBusy] = useState(false);
  const [packagingEligibility,setPackagingEligibility]=useState<{eligible:boolean;reasons:string[];pilotEnabled:boolean}|null>(null);
  const [savedPackaging,setSavedPackaging]=useState('');
  const canActivatePackaging=['Super Admin','Store Manager'].includes(currentRole);
  const openPackaging = async (product: Product) => {
    setPackagingBusy(true);
    setPackagingEligibility(null);setSavedPackaging('');setLegacyUnitId('');setHistoryLines(null);setHistoryUnits({});
    try {
      const response = await authFetch('/api/products/' + encodeURIComponent(product.id) + '/packaging-draft');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load selling units.');
      setSavedPackaging(product.sharedStockUnits ? JSON.stringify(product.sharedStockUnits) : body.configuration ? JSON.stringify(body.configuration) : '');
      setPackaging(product.sharedStockUnits || body.configuration || {baseUnit:'Piece',units:[{id:crypto.randomUUID(),label:'Piece',baseUnits:1,sellingPrice:product.sellingPrice}]});
      setPackagingProduct(product);
    } catch(error) { notify.error(error instanceof Error ? error.message : String(error)); }
    finally { setPackagingBusy(false); }
  };
  const savePackaging = async () => {
    if (!packagingProduct || packagingBusy || packagingProduct.sharedStockUnits) return;
    setPackagingBusy(true);
    try {
      validateSharedStock(packaging);
      const response = await authFetch('/api/products/' + encodeURIComponent(packagingProduct.id) + '/packaging-draft', {
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({configuration:packaging})
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to save selling units.');
      notify.success('Packaging draft saved. Stock and billing remain unchanged.');
      setPackaging(body.configuration);setSavedPackaging(JSON.stringify(body.configuration));setPackagingEligibility(null);
    } catch(error) { notify.error(error instanceof Error ? error.message : String(error)); }
    finally { setPackagingBusy(false); }
  };

  const checkPackaging = async () => {
    if(!packagingProduct || packagingBusy || !canActivatePackaging)return;
    setPackagingBusy(true);setPackagingEligibility(null);setHistoryLines(null);setHistoryUnits({});
    try{const response=await authFetch('/api/products/'+encodeURIComponent(packagingProduct.id)+'/packaging-eligibility');const body=await response.json();if(!response.ok)throw Error(body.error);setPackagingEligibility(body);
      const historyResponse=await authFetch('/api/products/'+encodeURIComponent(packagingProduct.id)+'/packaging-history');
      const history=await historyResponse.json();
      if(!historyResponse.ok||!Array.isArray(history.lines))throw Error(history.error||'Unable to load historical invoices.');
      setHistoryLines(history.lines);
    }
    catch(error){notify.error(String(error));}finally{setPackagingBusy(false);}
  };
  const activateSavedPackaging = async () => {
    if(!packagingProduct || packagingBusy || !canActivatePackaging || !packagingEligibility?.eligible || !packagingEligibility.pilotEnabled || savedPackaging!==JSON.stringify(packaging))return;
    if(!window.confirm('Activate the saved packaging configuration? Stock will remain unchanged; packaging factors cannot be edited after activation.'))return;
    setPackagingBusy(true);
    try{const response=await authFetch('/api/products/'+encodeURIComponent(packagingProduct.id)+'/packaging-activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true})});const body=await response.json();if(!response.ok)throw Error(body.error);notify.success('Shared stock activated. Reloading product data.');window.location.reload();}
    catch(error){notify.error(String(error));}finally{setPackagingBusy(false);setPackagingEligibility(null);}
  };

  const saveActivePrices=async()=>{
    if(!packagingProduct?.sharedStockUnits || !canActivatePackaging || packagingBusy)return;
    setPackagingBusy(true);
    try{
      const response=await authFetch('/api/products/'+encodeURIComponent(packagingProduct.id)+'/packaging-prices',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected:JSON.parse(savedPackaging),configuration:packaging})});
      const body=await response.json();if(!response.ok)throw Error(body.error||'Price update failed.');
      notify.success('Packaging prices updated. Reloading product data.');window.location.reload();
    }catch(error){notify.error(String(error));}finally{setPackagingBusy(false);}
  };

  const conversionPreview=useMemo(()=>{
    if(!packagingProduct || packagingProduct.sharedStockUnits || !legacyUnitId)return null;
    try{return {result:previewLegacyPackaging({quantity:packagingProduct.quantity,reorderLevel:packagingProduct.reorderLevel,costPrice:packagingProduct.costPrice,sellingPrice:packagingProduct.sellingPrice,legacyUnitId,configuration:packaging}),error:''};}
    catch(error){return {result:null,error:error instanceof Error?error.message:String(error)};}
  },[packagingProduct,legacyUnitId,packaging]);
  const convertExistingPackaging=async()=>{
    const preview=conversionPreview?.result;
    if(!packagingProduct || packagingProduct.sharedStockUnits || packagingBusy || !canActivatePackaging || !packagingEligibility?.pilotEnabled || !preview?.eligible || !historyComplete || savedPackaging!==JSON.stringify(packaging))return;
    if(!window.confirm('Convert '+preview.oldQuantity+' '+preview.legacyUnit+' to '+preview.newQuantity+' '+preview.baseUnit+'? Confirm the current stock unit and inventory value are correct. This changes the inventory unit permanently.'))return;
    setPackagingBusy(true);
    try{
      const expected={quantity:packagingProduct.quantity,reorderLevel:packagingProduct.reorderLevel,costPrice:packagingProduct.costPrice,sellingPrice:packagingProduct.sellingPrice};
      const response=await authFetch('/api/products/'+encodeURIComponent(packagingProduct.id)+'/packaging-convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,legacyUnitId,expected,configuration:packaging,historicalUnits:historyLines?.map(line=>({saleItemId:line.saleItemId,unitId:historyUnits[line.saleItemId]}))})});
      const body=await response.json();
      if(!response.ok)throw Error(body.error||'Conversion failed.');
      notify.success('Inventory converted successfully. Reloading product data.');
      window.location.reload();
    }catch(error){notify.error(error instanceof Error?error.message:String(error));}
    finally{setPackagingBusy(false);setPackagingEligibility(null);}
  };
  const categories = Array.from(
    new Set([
      ...defaultCategories,
      ...((taxConfig?.productCategories || []).map((categoryName) => categoryName.trim()).filter(Boolean)),
      ...products.map((product) => product.category.trim()).filter(Boolean),
    ])
  ).sort((left, right) => left.localeCompare(right));

  const uniqueBrands = useMemo(() => {
    return Array.from(
      new Set(products.map((p) => p.brand.trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right));
  }, [products]);

  const showWarranty = useMemo(() => {
    const normalized = String(category || '').toLowerCase().trim();
    if (!normalized) return false;
    return ['tool', 'power', 'machinery', 'equipment', 'generator', 'pump', 'electrical', 'electronic', 'breaker', 'drill', 'grinder', 'saw'].some(kw => normalized.includes(kw));
  }, [category]);

  const getCategoryDetailFields = (categoryName: string) => {
    const normalizedCategory = String(categoryName || '').toLowerCase().trim();
    if (!normalizedCategory) {
      return [] as string[];
    }

    const matchedTemplate = categoryAttributeTemplates.find((template) =>
      template.match.some((keyword) => normalizedCategory.includes(keyword))
    );

    return matchedTemplate ? matchedTemplate.fields : [];
  };

  const pickRelatedAttributes = (attributes: Record<string, string> | undefined, detailFields: string[]) => {
    if (detailFields.length === 0) {
      return attributes || {};
    }

    return Object.fromEntries(
      detailFields
        .map((fieldKey) => [fieldKey, String((attributes || {})[fieldKey] || '')])
        .filter(([, value]) => value.trim().length > 0)
    );
  };

  const handleCategoryChange = (nextCategory: string) => {
    const detailFields = getCategoryDetailFields(nextCategory);
    setCategory(nextCategory);
    setSimpleProductAttributes((current) => pickRelatedAttributes(current, detailFields));
    setVariants((current) =>
      current.map((variant) => ({
        ...variant,
        attributes: pickRelatedAttributes(variant.attributes, detailFields),
      }))
    );
  };

  const createVariantDraft = (partial?: Partial<ProductVariant>): ProductVariant => ({
    id: partial?.id || `var-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: partial?.name || 'Default Variant',
    unit: partial?.unit || 'Piece',
    sku: partial?.sku || '',
    barcode: partial?.barcode || '',
    qrCode: partial?.qrCode,
    costPrice: Number(partial?.costPrice || 0),
    sellingPrice: Number(partial?.sellingPrice || 0),
    wholesalePrice: Number(partial?.wholesalePrice || 0),
    dealerPrice: Number(partial?.dealerPrice || 0),
    quantity: Number(partial?.quantity || 0),
    reorderLevel: Number(partial?.reorderLevel || 10),
    weight: partial?.weight != null ? Number(partial.weight) : undefined,
    attributes: partial?.attributes || {},
  });

  const hasSyntheticSingleVariant = (product: Product) => {
    if (!Array.isArray(product.variants) || product.variants.length !== 1) {
      return false;
    }

    const [variant] = product.variants;
    return variant.sku === product.sku && variant.barcode === product.barcode;
  };

  const updateVariant = (index: number, patch: Partial<ProductVariant>) => {
    setVariants((current) => current.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  };

  const addVariant = () => {
    setVariants((current) => [
      ...current,
      createVariantDraft({
        name: `${name || 'Product'} Variant ${current.length + 1}`,
        sku: `${sku || 'SKU'}-V${current.length + 1}`,
        barcode: `${barcode || '100000000000'}${current.length + 1}`,
      }),
    ]);
  };

  const removeVariant = (index: number) => {
    setVariants((current) => current.filter((_, idx) => idx !== index));
  };

  const addVariantAttribute = (index: number) => {
    setVariants((current) => current.map((item, idx) => {
      if (idx !== index) {
        return item;
      }
      const nextAttributes: Record<string, string> = { ...(item.attributes || {}) };
      let key = 'Attribute';
      let counter = 1;
      while (Object.prototype.hasOwnProperty.call(nextAttributes, key)) {
        counter += 1;
        key = `Attribute ${counter}`;
      }
      nextAttributes[key] = '';
      return { ...item, attributes: nextAttributes };
    }));
  };

  const updateVariantAttribute = (index: number, oldKey: string, newKey: string, value: string) => {
    setVariants((current) => current.map((item, idx) => {
      if (idx !== index) {
        return item;
      }
      const attributes = { ...(item.attributes || {}) };
      delete attributes[oldKey];
      const normalizedKey = newKey.trim() || oldKey;
      attributes[normalizedKey] = value;
      return { ...item, attributes };
    }));
  };

  const setCategoryAttributeValue = (index: number, key: string, value: string) => {
    setVariants((current) => current.map((item, idx) => {
      if (idx !== index) {
        return item;
      }
      const attributes = { ...(item.attributes || {}) };
      attributes[key] = value;
      return { ...item, attributes };
    }));
  };

  const removeVariantAttribute = (index: number, key: string) => {
    setVariants((current) => current.map((item, idx) => {
      if (idx !== index) {
        return item;
      }
      const attributes = { ...(item.attributes || {}) };
      delete attributes[key];
      return { ...item, attributes };
    }));
  };

  // Open form for adding
  const handleOpenAdd = () => {
    setEditingProduct(null);
    setNewProductMultipleUnits(false);
    setShowAdvancedProduct(false);
    const generatedCode = 'ARS-' + crypto.randomUUID().slice(0, 12).toUpperCase();
    setName('');
    setSku(generatedCode);
    // Internal scan code only; never fabricate a manufacturer's EAN barcode.
    setBarcode(generatedCode);
    setInternalCode('');
    setBrand('');
    setCategory('');
    setCostPrice(0);
    setSellingPrice(0);
    setQuantity(0);
    setReorderLevel(15);
    setWarranty('No Warranty');
    setDescription('');
    setLongDescription('');
    setStatus('Active');
    setLocation('Aisle 1, Level 1');
    setImageUrl('');
    setSimpleProductAttributes({});
    // Ordinary hardware products do not need a synthetic variant.
    // Only real size/colour/pack variants should override base price and stock.
    setVariants([]);
    setIsFormOpen(true);
  };

  // Open form for editing
  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setShowAdvancedProduct(false); // Advanced fields remain accessible without overwhelming staff.
    setName(p.name);
    setSku(p.sku);
    setBarcode(p.barcode);
    setInternalCode(p.internalCode || '');
    setBrand(p.brand);
    setCategory(p.category);
    setCostPrice(p.costPrice);
    setSellingPrice(p.sellingPrice);
    setQuantity(p.quantity);
    setReorderLevel(p.reorderLevel);
    setWarranty(p.warranty);
    setDescription(p.description);
    setLongDescription(p.longDescription || '');
    setStatus(p.status || 'Active');
    setLocation(p.location || '');
    setImageUrl(sanitizeImageSrc(p.imageUrl) || '');

    const isSynthetic = hasSyntheticSingleVariant(p);
    if (isSynthetic && p.variants?.[0]) {
      setSimpleProductAttributes(p.variants[0].attributes || {});
    } else {
      setSimpleProductAttributes({});
    }

    setVariants(
      Array.isArray(p.variants) && p.variants.length > 0 && !isSynthetic
        ? p.variants.map((item) => createVariantDraft(item))
        : []
    );
    setIsFormOpen(true);
  };

  const handleImageUpload = async (file: File) => {
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await authFetch('/api/uploads/product-image', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Image upload failed');
      }

      setImageUrl(sanitizeImageSrc(data.imageUrl) || '');
    } catch (err: any) {
      notify.warning(err.message || 'Failed to upload image');
    } finally {
      setIsUploadingImage(false);
    }
  };

  // Submit product Form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = category.trim();
    if (!name.trim() || !sku.trim() || !barcode.trim()) {
      notify.warning('Enter a product name. Product codes are generated automatically.');
      return;
    }
    if (!finalCategory) {
      notify.warning('Please choose or enter a category.');
      return;
    }

    const cleanedVariants = variants
      .map((variant) => ({
        ...variant,
        name: String(variant.name || '').trim(),
        unit: String(variant.unit || '').trim() || 'Piece',
        sku: String(variant.sku || '').trim(),
        barcode: String(variant.barcode || '').trim(),
        attributes: Object.fromEntries(
          Object.entries(variant.attributes || {})
            .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
            .filter(([key, value]) => key.length > 0 && value.length > 0)
        ),
      }))
      .filter((variant) => variant.name && variant.sku && variant.barcode);

    const hasVariants = cleanedVariants.length > 0;
    const hasSimpleAttributes = Object.keys(simpleProductAttributes).length > 0;

    const primaryVariant = cleanedVariants[0];
    const totalVariantQty = hasVariants
      ? cleanedVariants.reduce((sum, variant) => sum + (Number(variant.quantity) || 0), 0)
      : Number(quantity || 0);

    if (!editingProduct && newProductMultipleUnits && (totalVariantQty !== 0 || hasVariants || hasSimpleAttributes)) { notify.warning('Multiple-unit products must start with zero stock and no independent variants. Receive stock after configuring packaging.'); return; }
    setIsSubmitting(true);

    const finalVariants = hasVariants 
      ? cleanedVariants 
      : (hasSimpleAttributes 
          ? [
              createVariantDraft({
                name: 'Default Variant',
                unit: 'Piece',
                sku: sku,
                barcode: barcode,
                costPrice: Number(costPrice),
                sellingPrice: Number(sellingPrice),
                wholesalePrice: Number(editingProduct?.wholesalePrice || 0),
                dealerPrice: Number(editingProduct?.dealerPrice || 0),
                quantity: Number(quantity),
                reorderLevel: Number(reorderLevel),
                attributes: simpleProductAttributes,
              })
            ]
          : (editingProduct ? [] : undefined));

    const payload = {
      name,
      sku: primaryVariant?.sku || sku,
      barcode: primaryVariant?.barcode || barcode,
      internalCode: internalCode.trim() ? internalCode.trim().toUpperCase() : undefined,
      brand,
      category: finalCategory,
      costPrice: Number(primaryVariant?.costPrice ?? costPrice),
      sellingPrice: Number(primaryVariant?.sellingPrice ?? sellingPrice),
      wholesalePrice: Number(primaryVariant?.wholesalePrice ?? editingProduct?.wholesalePrice ?? 0),
      dealerPrice: Number(primaryVariant?.dealerPrice ?? editingProduct?.dealerPrice ?? 0),
      quantity: totalVariantQty,
      reorderLevel: Number(primaryVariant?.reorderLevel ?? reorderLevel),
      warranty,
      description,
      longDescription,
      status,
      location,
      imageUrl,
      variants: finalVariants,
    };

    try {
      if (editingProduct) {
        await onEditProduct(editingProduct.id, { ...payload, reason: 'Modified catalog specifications' });
      } else {
        const created=await onAddProduct(payload);
        if(newProductMultipleUnits){setIsFormOpen(false);await openPackaging(created);notify.success('Product created. Configure its selling units before receiving stock.');return;}
      }
      notify.success(editingProduct ? 'Product updated successfully.' : 'Product saved and ready for billing.');
      setIsFormOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify.error(message.includes('already used') ? message : 'Could not save product. ' + message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, label: string) => {
    const isSuper = currentRole === 'Super Admin';
    if (!isSuper) {
      notify.error('Permission Denied: Only Super Admin role holds authorities to erase catalog entries.');
      return;
    }

    if (window.confirm(`Are you absolutely sure you want to permanently delete "${label}" from directory?`)) {
      try {
        await onDeleteProduct(id);
      } catch (err) {
        notify.error('Failed to delete product: ' + err);
      }
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = newCategoryName.trim();
    if (!normalized) {
      notify.warning('Please enter a category name.');
      return;
    }
    if (categories.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      notify.error('That category already exists.');
      return;
    }

    setIsCategorySubmitting(true);
    try {
      await onAddCategory(normalized);
      setNewCategoryName('');
      handleCategoryChange(normalized);
      setIsCategoryModalOpen(false);
    } catch (err) {
      notify.error('Failed to add category: ' + err);
    } finally {
      setIsCategorySubmitting(false);
    }
  };

  // Filter checklist
  const filtered = products.filter((p) => {
    const variantSearchBlob = (p.variants || [])
      .map((variant) => {
        const attrs = Object.entries(variant.attributes || {}).map(([key, value]) => `${key}:${value}`).join(' ');
        return [variant.name, variant.sku, variant.barcode, attrs].join(' ');
      })
      .join(' ')
      .toLowerCase();
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.barcode.includes(searchTerm) ||
      (p.internalCode || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      variantSearchBlob.includes(searchTerm.toLowerCase());
    const matchesCat = categoryFilter === 'All' || p.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  // Access flags
  const canModify = ['Super Admin', 'Store Manager', 'Inventory Staff'].includes(currentRole);

  const catalogModalOpen = isFormOpen || !!packagingProduct || isCategoryModalOpen;
  useEffect(() => {
    if (!catalogModalOpen) return;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
    };
  }, [catalogModalOpen]);

  return (
    <div className="space-y-6 motion-safe:animate-fade-in">
      {/* View Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-heading font-medium tracking-tight text-slate-900">
            Hardware Catalog Directory
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Find products quickly. Add a standard item in seconds or expand advanced options.
          </p>
        </div>

        {canModify && (
          <button
            id="btn-add-product"
            onClick={handleOpenAdd}
            className="bg-slate-900 hover:bg-slate-950 text-slate-100 text-xs font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 shadow-xs transition"
          >
            <Plus className="w-4 h-4" /> Add Product
          </button>
        )}
      </div>

      {/* Control Filters Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-2xs flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-85">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
          <input
            id="catalog-search"
            type="text"
            placeholder="Search products by Name, SKU, or Barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 text-slate-800 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-sans"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <select
            id="catalog-category-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full md:w-56 bg-slate-50 border border-slate-200 p-2 rounded-lg text-xs font-sans text-slate-700"
          >
            <option value="All">All Hardware Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          {canModify && (
            <button
              type="button"
              onClick={() => setIsCategoryModalOpen(true)}
              className="shrink-0 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition"
            >
              Add Category
            </button>
          )}
        </div>
      </div>

      {/* Catalog Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-100 text-slate-500 font-medium">
                <th className="p-4">SKU / Barcode</th>
                <th className="p-4">Item Details</th>
                <th className="p-4">Department</th>
                <th className="p-4 text-right">Cost Price</th>
                <th className="p-4 text-right">Selling Price</th>
                <th className="p-4 text-right">Profit / Unit</th>
                <th className="p-4 text-right">Profit in Stock</th>
                <th className="p-4 text-right">Markup%</th>
                <th className="p-4 text-center">Available Stock</th>
                <th className="p-4 text-center">Shelving Loc.</th>
                {canModify && <th className="p-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => {
                const markup = p.costPrice > 0 ? ((p.sellingPrice - p.costPrice) / p.costPrice) * 100 : 0;
                const unitProfit = p.sellingPrice - p.costPrice;
                const stockProfit = unitProfit * p.quantity;
                const isLow = p.quantity <= p.reorderLevel;
                const isOut = p.quantity <= 0;

                return (
                  <tr key={p.id} id={`catalog-row-${p.id}`} className="hover:bg-slate-50/50 transition duration-150">
                    <td className="p-4 font-mono">
                      <span className="text-indigo-600 font-semibold block text-xs">{p.sku}</span>
                      <span className="text-slate-400 text-[10px] flex items-center gap-1 mt-0.5">
                        <Barcode className="w-3.5 h-3.5 shrink-0" /> {p.barcode}
                      </span>
                      {p.internalCode ? (
                        <span className="text-[10px] mt-1 inline-block px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold">
                          Internal: {p.internalCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-[9px] text-slate-400">NO IMG</div>
                          )}
                        </div>
                        <div>
                        <div className="font-semibold text-slate-900 text-sm max-w-sm" title={p.name}>
                          {p.name}
                        </div>
                        <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
                          Brand: {p.brand || 'Generic'} • Warranty: {p.warranty}
                        </span>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-slate-100 text-slate-600">
                        {p.category}
                      </span>
                    </td>
                    <td className="p-4 text-right font-mono text-slate-600">
                      {currencySymbol}{p.costPrice.toFixed(2)}
                    </td>
                    <td className="p-4 text-right font-mono font-semibold text-slate-900">
                      {currencySymbol}{p.sellingPrice.toFixed(2)}
                    </td>
                    <td className={`p-4 text-right font-mono font-bold ${unitProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {unitProfit >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(unitProfit).toFixed(2)}
                    </td>
                    <td className={`p-4 text-right font-mono font-bold ${stockProfit >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>
                      {stockProfit >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(stockProfit).toFixed(2)}
                    </td>
                    <td className="p-4 text-right font-mono text-emerald-600 font-bold">
                      {markup.toFixed(0)}%
                    </td>
                    <td className="p-4 text-center">
                      <span
                        className={`inline-block px-3 py-1 font-mono font-bold rounded-lg text-xs leading-none ${
                          isOut
                            ? 'bg-rose-100 text-rose-700'
                            : isLow
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {p.quantity} {isOut ? 'OUT' : isLow ? 'LOW' : 'OK'}
                      </span>
                      <span className="block text-[9px] text-slate-400 mt-1 font-mono">Reorder Min: {p.reorderLevel}</span>
                    </td>
                    <td className="p-4 text-center text-slate-500 font-mono text-[10px]">
                      <div className="flex items-center justify-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        <span>{p.location || '-'}</span>
                      </div>
                    </td>

                    {/* Modification trigger icons */}
                    {canModify && (
                      <td className="p-4 text-right space-x-1 whitespace-nowrap">
                        <button
                          id={`btn-edit-prod-${p.id}`}
                          onClick={() => handleOpenEdit(p)}
                          className="p-1.5 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 inline-block transition"
                          title="Modify product specs"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`btn-delete-prod-${p.id}`}
                          onClick={() => handleDelete(p.id, p.name)}
                          className="p-1.5 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600 inline-block transition"
                          title="Deregister product"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-20 text-slate-400 font-sans border-t border-slate-100">
                    <Package className="w-12 h-12 mx-auto text-slate-200" />
                    <p className="text-sm font-semibold mt-2">No matching hardware products</p>
                    <p className="text-xs text-slate-500">Refine category filter scope or keyword search</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FORM MODAL PANEL (DRAWER overlay style) */}
      {isFormOpen && createPortal(
        <div id="product-modal-root" className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-[100]">
          <div role="dialog" aria-modal="true" aria-label={editingProduct ? "Edit product" : "Add product"} className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl border border-slate-200 max-h-[92dvh] flex flex-col overflow-hidden font-sans relative">
            <button
              type="button"
              aria-label="Close product editor"
              onClick={() => setIsFormOpen(false)}
              className="absolute top-4 right-4 z-10 rounded-lg p-2 text-white hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="shrink-0 bg-[#182a45] px-5 py-4 pr-14 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">ARS Distributors · Product catalog</p>
              <h3 className="mt-1 text-xl font-bold">{editingProduct ? 'Edit product' : 'Add product'}</h3>
              <p className="mt-1 text-sm text-slate-300">{editingProduct ? editingProduct.name+' · '+editingProduct.sku : 'Register a wholesale product and its selling units.'}</p>
            </div>
            <form id="ars-product-editor" onSubmit={handleSubmit} className="min-h-0 flex flex-1 flex-col text-xs font-sans">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/70 px-4 py-4 sm:px-6">
              <div className="grid grid-cols-2 gap-3">
                {/* Store Department Category at the very top (full width) */}
                <div className="col-span-2 bg-indigo-50/40 p-2.5 rounded-xl border border-indigo-150 shadow-2xs">
                  <label className="block text-indigo-950 font-bold mb-1.5 text-sm">Category *</label>
                  <input
                    id="input-prod-category"
                    type="text"
                    required
                    value={category}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    list="catalog-category-suggestions"
                    placeholder="Or type another category"
                    className="w-full bg-white border border-slate-250 p-2.5 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium"
                  />
                  <datalist id="catalog-category-suggestions">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                {/* Core fields are always visible: staff can complete them in any order. */}
                  <>
                    <div className="col-span-2">
                      <label className="block text-slate-500 font-semibold mb-1">Product name *</label>
                      <input
                        id="input-prod-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. PVC Pipe 1 inch"
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    {matchingProducts.length > 0 && (
                      <div role="alert" className="col-span-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        <div className="font-bold">This product name is already in your catalog.</div>
                        <p className="mt-1 text-xs">Check the existing product before adding another one.</p>
                        {matchingProducts.map((match) => (
                          <button key={match.id} type="button" onClick={() => handleOpenEdit(match)}
                            className="mt-2 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-xs font-semibold text-amber-900 hover:bg-amber-100">
                            Edit existing: {match.name} · {match.sku}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="col-span-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
                       <strong>No product code to remember.</strong> ARS creates a code for you. Use More product options when you have a barcode or special specifications.
                     </div>

                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Buying cost ({currencySymbol})</label>
                      <input
                        id="input-prod-cost"
                        type="number"
                        step="0.01"
                        min="0"
                        value={costPrice}
                        onChange={(e) => setCostPrice(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Selling price ({currencySymbol})</label>
                      <input
                        id="input-prod-sell"
                        type="number"
                        step="0.01"
                        min="0"
                        value={sellingPrice}
                        onChange={(e) => setSellingPrice(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">{editingProduct ? "Current stock quantity" : "Opening stock quantity"}</label>
                      <input
                        id="input-prod-qty"
                        type="number"
                        min="0"
                        value={quantity}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>

                  </>

                <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-3">
                  {sanitizeImageSrc(imageUrl) ? <img src={sanitizeImageSrc(imageUrl) || undefined} alt="Product photo preview" className="h-20 w-20 rounded-lg border border-slate-200 object-contain" /> : <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50"><Package className="h-7 w-7 text-slate-400" /></div>}
                  <div className="min-w-0 flex-1"><label htmlFor="input-prod-image" className="block font-semibold text-slate-800">{imageUrl ? 'Replace product photo' : 'Add product photo'}</label><input id="input-prod-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={isUploadingImage || isSubmitting} onChange={e=>{const file=e.target.files?.[0];if(file)handleImageUpload(file);e.target.value='';}} className="mt-2 block w-full text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-semibold file:text-indigo-700" /><p className="mt-1 text-xs text-slate-500">PNG, JPG, WEBP or GIF · up to 5 MB</p>{isUploadingImage && <p role="status" className="mt-1 text-indigo-700">Uploading image…</p>}{imageUrl && !isUploadingImage && <button type="button" onClick={()=>setImageUrl('')} className="mt-1 font-semibold text-rose-700">Remove photo</button>}</div>
                </div>
                <div className="col-span-2">
                  <button type="button" onClick={() => setShowAdvancedProduct(value => !value)}
                    aria-expanded={showAdvancedProduct}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-100">
                    <span>More product options (optional)</span>
                    <span aria-hidden="true">{showAdvancedProduct ? '−' : '+'}</span>
                  </button>
                </div>
                {showAdvancedProduct && <div className="col-span-2 grid grid-cols-2 gap-3">
                  <p className="col-span-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Optional product details</p>
                     <div className="col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">ARS codes can be replaced if your product has a supplier barcode. Keep them unique for accurate stock tracking.</div>
                     <div>
                      <label className="block text-slate-500 font-semibold mb-1">Product SKU *</label>
                      <input
                        id="input-prod-sku"
                        type="text"
                        required
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 uppercase font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Barcode / Internal Scan Code *</label>
                      <input
                        id="input-prod-barcode"
                        type="text"
                        required
                        value={barcode}
                        onChange={(e) => setBarcode(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>

                    
                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Manufacturer Brand</label>
                      <input
                        id="input-prod-brand"
                        type="text"
                        value={brand}
                        onChange={(e) => setBrand(e.target.value)}
                        list="catalog-brand-suggestions"
                        placeholder="e.g. Stanley, Hilti, Dewalt"
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                      />
                      <datalist id="catalog-brand-suggestions">
                        {uniqueBrands.map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    </div>

                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Internal Code (Admin Only)</label>
                      <input
                        id="input-prod-internal-code"
                        type="text"
                        value={internalCode}
                        onChange={(e) => setInternalCode(e.target.value.toUpperCase())}
                        placeholder="e.g. YMV, TSK"
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 uppercase font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Warning Reorder Level</label>
                      <input
                        id="input-prod-reorder"
                        type="number"
                        min="1"
                        value={reorderLevel}
                        onChange={(e) => setReorderLevel(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Store Floor location</label>
                      <input
                        id="input-prod-loc"
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g. Aisle 4, Level 2"
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Status</label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as 'Active' | 'Inactive')}
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>

                    {showWarranty && (
                      <div className="col-span-2">
                        <label className="block text-slate-500 font-semibold mb-1">Warranty Details</label>
                        <input
                          id="input-prod-warranty"
                          type="text"
                          value={warranty}
                          onChange={(e) => setWarranty(e.target.value)}
                          placeholder="e.g. 1 Year Replacement, No Warranty"
                          className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    )}

                    <div className="col-span-2">
                      <label className="block text-slate-500 font-semibold mb-1">Technological Description</label>
                      <textarea
                        id="input-prod-desc"
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Provide heavy hardware specs (dimensions, load capacities, standard certificates)"
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-sans"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-slate-500 font-semibold mb-1">Long Description</label>
                      <textarea
                        rows={2}
                        value={longDescription}
                        onChange={(e) => setLongDescription(e.target.value)}
                        placeholder="Detailed product description, specs and usage guidance"
                        className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-sans"
                      />
                    </div>

                {/* Category-Specific Attributes for Simple Product */}
                {variants.length === 0 && (() => {
                  const categoryDetailFields = getCategoryDetailFields(category);
                  const hasCategoryTemplate = categoryDetailFields.length > 0;
                  if (!hasCategoryTemplate) return null;

                  return (
                    <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
                      <h4 className="text-slate-700 font-semibold flex items-center gap-1.5">
                        Category Specifications ({category})
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {categoryDetailFields.map((fieldKey) => (
                          <div key={`simple-${fieldKey}`}>
                            <label className="block text-[10px] text-slate-500 font-semibold mb-1">{fieldKey}</label>
                            <input
                              value={String(simpleProductAttributes[fieldKey] || '')}
                              onChange={(e) => setSimpleProductAttributeValue(fieldKey, e.target.value)}
                              placeholder={`Enter ${fieldKey.toLowerCase()}`}
                              className="w-full bg-slate-50 border border-slate-200 p-2 rounded text-xs focus:outline-none focus:border-amber-500"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-slate-700 font-semibold flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-indigo-500" /> Product Variants (Unit-Based Pricing)
                    </h4>
                    <button
                      type="button"
                      onClick={addVariant}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <PlusCircle className="w-3.5 h-3.5" /> Add Variant
                    </button>
                  </div>

                  {variants.map((variant, variantIndex) => (
                    <div key={variant.id} className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                      {(() => {
                        const categoryDetailFields = getCategoryDetailFields(category);
                        const hasCategoryTemplate = categoryDetailFields.length > 0;

                        return (
                          <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          value={variant.name}
                          onChange={(e) => updateVariant(variantIndex, { name: e.target.value })}
                          placeholder="Variant name (e.g. 20 Liter / 12W)"
                          className="bg-slate-50 border border-slate-200 p-2 rounded"
                        />
                        <select
                          value={variant.unit}
                          onChange={(e) => updateVariant(variantIndex, { unit: e.target.value })}
                          className="bg-slate-50 border border-slate-200 p-2 rounded"
                        >
                          {unitOptions.map((unit) => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                        </select>
                        <input
                          value={variant.sku}
                          onChange={(e) => updateVariant(variantIndex, { sku: e.target.value })}
                          placeholder="Variant SKU"
                          className="bg-slate-50 border border-slate-200 p-2 rounded font-mono"
                        />
                        <input
                          value={variant.barcode}
                          onChange={(e) => updateVariant(variantIndex, { barcode: e.target.value })}
                          placeholder="Variant Barcode"
                          className="bg-slate-50 border border-slate-200 p-2 rounded font-mono"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={variant.costPrice}
                          onChange={(e) => updateVariant(variantIndex, { costPrice: Number(e.target.value) })}
                          placeholder="Cost"
                          className="bg-slate-50 border border-slate-200 p-2 rounded"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={variant.sellingPrice}
                          onChange={(e) => updateVariant(variantIndex, { sellingPrice: Number(e.target.value) })}
                          placeholder="Retail"
                          className="bg-slate-50 border border-slate-200 p-2 rounded"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={variant.wholesalePrice || 0}
                          onChange={(e) => updateVariant(variantIndex, { wholesalePrice: Number(e.target.value) })}
                          placeholder="Wholesale"
                          className="bg-slate-50 border border-slate-200 p-2 rounded"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={variant.dealerPrice || 0}
                          onChange={(e) => updateVariant(variantIndex, { dealerPrice: Number(e.target.value) })}
                          placeholder="Dealer"
                          className="bg-slate-50 border border-slate-200 p-2 rounded"
                        />
                        <input
                          type="number"
                          min="0"
                          value={variant.quantity}
                          onChange={(e) => updateVariant(variantIndex, { quantity: Number(e.target.value) })}
                          placeholder="Stock"
                          className="bg-slate-50 border border-slate-200 p-2 rounded"
                        />
                        <input
                          type="number"
                          min="0"
                          value={variant.reorderLevel}
                          onChange={(e) => updateVariant(variantIndex, { reorderLevel: Number(e.target.value) })}
                          placeholder="Reorder"
                          className="bg-slate-50 border border-slate-200 p-2 rounded"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-slate-600">
                            {hasCategoryTemplate ? 'Category Detail Fields' : 'Dynamic Attributes'}
                          </p>
                          {!hasCategoryTemplate && (
                            <button
                              type="button"
                              onClick={() => addVariantAttribute(variantIndex)}
                              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
                            >
                              + Add Attribute
                            </button>
                          )}
                        </div>

                        {hasCategoryTemplate ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {categoryDetailFields.map((fieldKey) => (
                              <div key={`${variant.id}-${fieldKey}`}>
                                <label className="block text-[10px] text-slate-500 font-semibold mb-1">{fieldKey}</label>
                                <input
                                  value={String((variant.attributes || {})[fieldKey] || '')}
                                  onChange={(e) => setCategoryAttributeValue(variantIndex, fieldKey, e.target.value)}
                                  placeholder={`Enter ${fieldKey.toLowerCase()}`}
                                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded"
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          Object.entries(variant.attributes || {}).map(([attrKey, attrValue]) => (
                            <div key={`${variant.id}-${attrKey}`} className="grid grid-cols-2 gap-2">
                              <input
                                value={attrKey}
                                onChange={(e) => updateVariantAttribute(variantIndex, attrKey, e.target.value, String(attrValue ?? ''))}
                                placeholder="Attribute (e.g. Watt, Volume, Color)"
                                className="bg-slate-50 border border-slate-200 p-2 rounded"
                              />
                              <div className="flex gap-2">
                                <input
                                  value={String(attrValue ?? '')}
                                  onChange={(e) => updateVariantAttribute(variantIndex, attrKey, attrKey, e.target.value)}
                                  placeholder="Value"
                                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeVariantAttribute(variantIndex, attrKey)}
                                  className="px-2 rounded bg-rose-50 text-rose-600 hover:bg-rose-100"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                          </>
                        );
                      })()}

                      {variants.length > 1 && (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => removeVariant(variantIndex)}
                            className="text-[11px] font-semibold text-rose-600 hover:text-rose-700"
                          >
                            Remove Variant
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  <p className="text-[10px] text-slate-500">
                    Example: Paint variant "20 Liter" with attributes Volume=20L and Finish=Matte, or Light variant "12W" with Watt=12W and Color=Warm White.
                  </p>
                </div>

                </div>}
              </div>
              </div>

              {/* Status Warning if quantity is lower than reorder level */}
              {variants.length === 0 && quantity <= reorderLevel && (
                <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-start gap-2 text-slate-700">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px]">
                    <strong>Note:</strong> Initial stock values set here are lower than or equal to the reorder safety levels. This product will trigger the system-wide Low Stock alerts banner.
                  </p>
                </div>
              )}

              {!editingProduct && <div className="mx-4 my-2 rounded-lg border border-slate-200 p-3"><label className="block font-semibold mb-2">Selling unit model</label><select className="w-full rounded border p-2" value={newProductMultipleUnits?'multiple':'single'} onChange={e=>setNewProductMultipleUnits(e.target.value==='multiple')}><option value="single">Single unit — fixed stock unit</option><option value="multiple">Multiple units — Box / Piece / Carton</option></select>{newProductMultipleUnits && <p className="mt-2 text-amber-800">Save with zero initial stock and no independent variants. The packaging window opens next.</p>}</div>}
              {editingProduct && <div className="px-4 py-2"><button type="button" disabled={packagingBusy || isSubmitting} onClick={()=>openPackaging(editingProduct)} className="rounded border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700">Configure selling units</button></div>}
              {/* Submitting buttons */}
              <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg "
                >
                  Cancel
                </button>
                <button
                  id="btn-submit-prod"
                  type="submit"
                  disabled={isSubmitting || isUploadingImage}
                  className="flex-1 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition"
                >
                  {isSubmitting ? 'Saving product...' : editingProduct ? 'Save Changes' : newProductMultipleUnits ? 'Save & Configure Units' : 'Save Product & Finish'}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}

      {packagingProduct && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <section role="dialog" aria-modal="true" aria-label="Packaging units" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl space-y-4">
            <h3 className="text-lg font-bold">Selling units · {packagingProduct.name}</h3>
            <p className="text-xs text-amber-800 bg-amber-50 p-3 rounded">{packagingProduct.sharedStockUnits ? "Active configuration — packaging factors protected. Managers may edit prices." : "Save a draft, then check eligibility. A manager must confirm activation."}</p>
            <fieldset disabled={packagingBusy || (!!packagingProduct.sharedStockUnits && !canActivatePackaging)} className="space-y-4">
            <label className="block text-sm">Base stock unit
              <input className="block w-full border rounded p-2" disabled={!!packagingProduct.sharedStockUnits} value={packaging.baseUnit} onChange={e=>setPackaging(old=>({...old,baseUnit:e.target.value}))}/>
            </label>
            <div className="space-y-2">
              {packaging.units.map((unit,index)=>(
                <div key={unit.id} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end border rounded p-2">
                  <label className="text-xs">U/M<input className="w-full border rounded p-2" disabled={!!packagingProduct.sharedStockUnits} value={unit.label} onChange={e=>setPackaging(old=>({...old,units:old.units.map((u,i)=>i===index?{...u,label:e.target.value}:u)}))}/></label>
                  <label className="text-xs">Base units<input type="number" min="1" step="1" className="w-full border rounded p-2" disabled={!!packagingProduct.sharedStockUnits} value={unit.baseUnits} onChange={e=>setPackaging(old=>({...old,units:old.units.map((u,i)=>i===index?{...u,baseUnits:Number(e.target.value)}:u)}))}/></label>
                  <label className="text-xs">Selling price<input type="number" min="0" step="0.01" className="w-full border rounded p-2" value={unit.sellingPrice} onChange={e=>setPackaging(old=>({...old,units:old.units.map((u,i)=>i===index?{...u,sellingPrice:Number(e.target.value)}:u)}))}/></label>
                  <button type="button" disabled={packagingBusy || !!packagingProduct.sharedStockUnits} className="text-xs text-rose-700 p-2" onClick={()=>setPackaging(old=>({...old,units:old.units.filter(u=>u.id!==unit.id)}))}>Remove</button>
                </div>
              ))}
            </div>
            <button type="button" disabled={packagingBusy || !!packagingProduct.sharedStockUnits || packaging.units.length>=30} className="border rounded p-2 text-sm" onClick={()=>setPackaging(old=>({...old,units:[...old.units,{id:crypto.randomUUID(),label:'Box',baseUnits:12,sellingPrice:0}]}))}>+ Add selling unit</button>
            </fieldset>
            {!packagingProduct.sharedStockUnits && (packagingProduct.quantity>0 || (historyLines?.length || 0)>0) && <section className="rounded-lg border border-slate-300 p-3 space-y-2">
              <h4 className="font-semibold text-sm">Existing stock conversion preview</h4>
              <p className="text-xs text-slate-600">Select the unit represented by the current inventory. Review the calculation before confirming conversion. Historical sales require individual verification. Purchases, quotations and independent variants remain protected.</p>
              <label className="block text-xs">Current stock unit<select className="w-full border rounded p-2" value={legacyUnitId} onChange={e=>setLegacyUnitId(e.target.value)}><option value="">Select current unit explicitly</option>{packaging.units.map(u=><option key={u.id} value={u.id}>{u.label} ({u.baseUnits} base units)</option>)}</select></label>
              {conversionPreview?.error && <p role="alert" className="text-xs text-rose-700">{conversionPreview.error}</p>}
              {conversionPreview?.result && <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Current stock<strong className="block">{conversionPreview.result.oldQuantity} {conversionPreview.result.legacyUnit}</strong></div>
                <div>Converted stock<strong className="block">{conversionPreview.result.newQuantity} {conversionPreview.result.baseUnit}</strong></div>
                <div>Current inventory value<strong className="block">Rs. {conversionPreview.result.valueBefore.toFixed(2)}</strong></div>
                <div>Converted inventory value<strong className="block">Rs. {conversionPreview.result.valueAfter.toFixed(2)}</strong></div>
                <div>Cost per base unit<strong className="block">Rs. {conversionPreview.result.newCostPrice.toFixed(2)}</strong></div>
                <div>Converted reorder level<strong className="block">{conversionPreview.result.newReorderLevel}</strong></div>
                <p className="col-span-2 text-amber-800">{conversionPreview.result.eligible?'Arithmetic checks passed. Save the draft and check eligibility before conversion. The server will recheck stock and transaction history.':conversionPreview.result.reasons.join(' ')}</p>
              </div>}
              {historyLines && historyLines.length>0 && <div className="space-y-2 border-t pt-3">
                <h4 className="font-semibold text-sm">Verify historical invoice units</h4>
                <p className="text-xs text-slate-600">Check the original invoice. Select each actual selling unit. No historical quantities are deducted again.</p>
                <div className="max-h-64 overflow-auto space-y-2">{historyLines.map(line=><div key={line.saleItemId} className="rounded border p-2 text-xs">
                  <strong>{line.invoiceNumber}</strong> · {line.status} · {String(line.date).slice(0,10)}
                  <p>Quantity: {line.quantity} · Rate: Rs. {line.sellingPrice.toFixed(2)} · Recorded U/M: {line.originalUnit||'Not recorded'}</p>
                  <select aria-label={'Verify unit for invoice '+line.invoiceNumber+' item '+line.saleItemId} className="mt-1 w-full rounded border p-2" disabled={packagingBusy||!!line.variantId||line.hasSharedSnapshot} value={historyUnits[line.saleItemId]||''} onChange={e=>setHistoryUnits(old=>({...old,[line.saleItemId]:e.target.value}))}>
                    <option value="">Select verified historical unit</option>{packaging.units.map(u=><option key={u.id} value={u.id}>{u.label} ({u.baseUnits} base units)</option>)}
                  </select>
                  {(line.variantId||line.hasSharedSnapshot)&&<p className="text-rose-700">Separate reconciliation required.</p>}
                </div>)}</div>
                <p role="status">{historyLines.filter(line=>packaging.units.some(u=>u.id===historyUnits[line.saleItemId])).length} / {historyLines.length} lines reviewed</p>
              </div>}
              {canActivatePackaging && <button type="button" disabled={packagingBusy || !historyComplete || !packagingEligibility?.pilotEnabled || !conversionPreview?.result?.eligible || savedPackaging!==JSON.stringify(packaging)} className="rounded border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-40" onClick={convertExistingPackaging}>Confirm &amp; convert stock</button>}
            </section>}
            {packagingEligibility && <div className="rounded border p-3 text-xs" role="status">{packagingEligibility.eligible?"Product meets eligibility checks.":packagingEligibility.reasons.join(" ")}{!packagingEligibility.pilotEnabled && " Selling-unit activation is disabled by system configuration."}</div>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" disabled={packagingBusy} className="p-2" onClick={()=>setPackagingProduct(null)}>Close</button>
              {!packagingProduct.sharedStockUnits && canActivatePackaging && <><button type="button" disabled={packagingBusy || savedPackaging!==JSON.stringify(packaging)} className="border rounded p-2" onClick={checkPackaging}>Check eligibility</button><button type="button" disabled={packagingBusy || !packagingEligibility?.eligible || !packagingEligibility?.pilotEnabled || savedPackaging!==JSON.stringify(packaging)} className="border rounded p-2 disabled:opacity-40" onClick={activateSavedPackaging}>Activate shared stock</button></>}
              {packagingProduct.sharedStockUnits && canActivatePackaging && <button type="button" disabled={packagingBusy || savedPackaging===JSON.stringify(packaging)} className="bg-indigo-600 text-white rounded p-2 disabled:opacity-40" onClick={saveActivePrices}>Save prices</button>}
              <button type="button" disabled={packagingBusy || !!packagingProduct.sharedStockUnits} className="bg-indigo-600 text-white rounded p-2 disabled:opacity-40" onClick={savePackaging}>{packagingBusy?'Saving…':'Save draft'}</button>
            </div>
          </section>
        </div>, document.body
      )}

      {isCategoryModalOpen && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm border border-slate-200 font-sans relative">
            <button
              onClick={() => setIsCategoryModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-medium text-slate-900 text-lg mb-4">Add Product Category</h3>

            <form onSubmit={handleCreateCategory} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Category Name</label>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Fasteners"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCategorySubmitting}
                  className="flex-1 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-3xs transition"
                >
                  {isCategorySubmitting ? 'Saving...' : 'Save Category'}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}
    </div>
  );
}
