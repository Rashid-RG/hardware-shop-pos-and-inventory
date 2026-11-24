# Hardware Shop ERP/POS Master Blueprint

> **Version:** 1.0 (Development Blueprint)

## Vision

Build a modern, premium Hardware Shop ERP/POS for retail and wholesale businesses with inventory, sales, purchasing, AI assistance, reporting, and construction calculators.

---

## Technology Stack

-   **Frontend & Routing**: Next.js 15 (App Router), React 19, TypeScript
-   **Styling & Animation**: Tailwind CSS, shadcn/ui, Framer Motion
-   **Database & ORM**: PostgreSQL, Prisma ORM
-   **Authentication**: JWT Authentication (via NextAuth.js or custom cookies) and bcrypt
-   **Form Handling & Validation**: Zod, React Hook Form
-   **State Management & Data Fetching**: Zustand, TanStack Query (React Query)
-   **Third-Party Services**: Cloudinary (Image Hosting), Google Gemini AI (AI Assistant), Vercel (Deployment)
-   **Charts & Visualizations**: Recharts
-   **Exporting & Sharing**: PDFKit (PDF Invoices), Nodemailer (SMTP Email Sharing), WhatsApp Business API

---

## Folder Structure (Next.js Target)

```text
hardware-erp/
├── app/                  # Next.js App Router (pages, API routes, layout)
├── components/           # Reusable global UI components (button, dialog, etc.)
├── features/             # Feature-based folders containing specific hooks, slices, and views
│   ├── pos/
│   ├── inventory/
│   ├── calculators/
│   └── ai/
├── lib/                  # Third-party configurations (prisma, cloudinary, gemini)
├── prisma/               # Prisma schema and seed scripts
├── public/               # Static assets
├── server/               # Custom backend/background services (optional)
├── hooks/                # Global React hooks
├── types/                # Global TypeScript definitions
├── utils/                # Utility helper functions
└── docs/                 # System documentation and manuals
```

---

## Modules & Expanded Implementation Tasks

### 1. Dashboard Module
- [ ] **Prisma Schema**: Write queries aggregating transaction, purchase, expense, and product tables.
- [ ] **API Routes**: Create `/api/dashboard/summary` (KPI metrics) and `/api/dashboard/charts` (historical sales/profits).
- [ ] **Frontend Views**: Build `DashboardView` with high-aesthetic grid layout.
- [ ] **Components**:
  - [ ] Metric cards with micro-animations showing Today's Sales, Today's Profit, Orders, Low Stock, Customer Credit Dues, and Supplier Balances.
  - [ ] Responsive Recharts area/bar chart for revenue and profit.
  - [ ] Low-stock and pending purchases warnings panel.
  - [ ] Gemini-driven AI insights text container for sales analysis.

### 2. Authentication Module
- [ ] **Prisma Schema**: Connect `users` table for credentials lookup.
- [ ] **API Routes**: `/api/auth/login`, `/api/auth/logout`, and `/api/auth/me`.
- [ ] **Frontend Views**: Build unified premium Login and Password Reset views.
- [ ] **Components**:
  - [ ] Login Form with Zod schema validation, React Hook Form, and error tooltips.
  - [ ] Secure HTTP-only cookie JWT session parser and route guards.
  - [ ] Rate limiter to block IP after 5 failed login attempts.

### 3. User & Role Management Module
- [ ] **Prisma Schema**: Ensure user roles mapping: `Owner`, `Super Admin`, `Branch Manager`, `Cashier`, `Inventory Manager`, `Warehouse Staff`, `Accountant`, `Purchasing Officer`, `Sales Representative`, `Delivery Driver`.
- [ ] **API Routes**: `/api/users` (CRUD) endpoints restricted to Super Admin/Owner roles.
- [ ] **Frontend Views**: User administration and permissions panel.
- [ ] **Components**:
  - [ ] Table containing user lists with role badges and edit actions.
  - [ ] Create/Edit User dialog checking password strength.

### 4. POS (Point of Sale) Module
- [ ] **Prisma Schema**: Define `SalesTransaction` and `SalesTransactionItem` tables with serial keys.
- [ ] **API Routes**: `/api/pos/checkout` (atomic stock depletion + transaction record creation).
- [ ] **Frontend Views**: High-performance full-screen POS terminal dashboard.
- [ ] **Components**:
  - [ ] Grid of products with text/barcode search filters and categories.
  - [ ] Active shopping cart sidebar with quantity adjusters, discount logic, and tax.
  - [ ] USB Barcode listener and integrated camera QR scanner using `jsqr`.
  - [ ] Split payment popup supporting Cash, Card, and Customer Credit limits.
  - [ ] Hold/Resume drawer saving cart states locally or on the DB.
  - [ ] Receipt generation and thermal-print action with multi-copy watermark logic (Original, Duplicate, etc.).

### 5. Products Module
- [ ] **Prisma Schema**: Update `Product` model with pricing tiers (Retail, Wholesale, Dealer), SKU, cost price, location, warranty, and long description.
- [ ] **API Routes**: `/api/products` (CRUD) endpoints with Cloudinary file upload.
- [ ] **Frontend Views**: Product management workspace with paginated tables.
- [ ] **Components**:
  - [ ] Product list table with column sorting and CSV/Excel export.
  - [ ] Multi-tab product editor form (Details, Pricing, Variant Combinations, Media).

### 6. Categories & Brands Module
- [ ] **Prisma Schema**: Define `Category` and `Brand` models.
- [ ] **API Routes**: `/api/categories` and `/api/brands` (CRUD).
- [ ] **Frontend Views**: Category and brand management settings views.
- [ ] **Components**:
  - [ ] List views with items count per category (e.g., Tiles, Cement, Paint, Pipes, Steel).

### 7. Units & Variants Module
- [ ] **Prisma Schema**: Model product variants (color, size, weight) and unit tables.
- [ ] **API Routes**: `/api/units` and `/api/variants` (CRUD).
- [ ] **Logic**: Conversion engine matching bulk to retail quantities (e.g., Box to Pieces, Bundle to Meters).
- [ ] **Components**:
  - [ ] Variant combination builder with pricing and unique SKU overrides.

### 8. Inventory & Warehouses Module
- [ ] **Prisma Schema**: Define `Warehouse`, `InventoryItem`, and `StockMovement` ledger tables.
- [ ] **API Routes**: `/api/inventory/adjustment` (write-offs and counts) and `/api/inventory/transfer` (warehouse movements).
- [ ] **Frontend Views**: Warehouse inventory dashboard.
- [ ] **Components**:
  - [ ] Multi-warehouse stock tracking grid.
  - [ ] Stock adjustment auditor sheet.

### 9. Stock Transfer Module
- [ ] **Prisma Schema**: Define `StockTransfer` tracking source, destination, items, and status (Pending, Sent, Received).
- [ ] **API Routes**: `/api/stock-transfers` (CRUD + status transition controls).
- [ ] **Frontend Views**: Transfer requests tracking dashboard.
- [ ] **Components**:
  - [ ] Status timeline stepper (Pending -> In-Transit -> Received).

### 10. Customers Module
- [ ] **Prisma Schema**: Define `Customer` table including loyalty balance, credit limit, and credit balance.
- [ ] **API Routes**: `/api/customers` (CRUD) and `/api/customers/:id/credit-payment` (credits adjustment).
- [ ] **Frontend Views**: Customer CRM list and ledger dashboard.
- [ ] **Components**:
  - [ ] Ledger sheet plotting invoices vs. payments and credit balance.

### 11. Suppliers Module
- [ ] **Prisma Schema**: Define `Supplier` table containing company name, contact info, and tax number.
- [ ] **API Routes**: `/api/suppliers` (CRUD) and `/api/suppliers/:id/ledger` (accounts payable).
- [ ] **Frontend Views**: Supplier management view.
- [ ] **Components**:
  - [ ] Supplier details panel tracking active Purchase Orders.

### 12. Purchases Module
- [ ] **Prisma Schema**: Define `PurchaseOrder` and `PurchaseOrderItem` tables.
- [ ] **API Routes**: `/api/purchases` (PO Creation, approvals, and Goods Received Notes logging).
- [ ] **Frontend Views**: Supplier purchasing lifecycle tracker.
- [ ] **Components**:
  - [ ] GRN (Goods Received Note) interface that increases product inventory.

### 13. Sales & Quotations Module
- [ ] **Prisma Schema**: Define `Quotation` and `QuotationItem` tables.
- [ ] **API Routes**: `/api/quotations` (CRUD) and `/api/quotations/:id/convert` (converts quote to POS invoice).
- [ ] **Frontend Views**: Quotations manager view.
- [ ] **Components**:
  - [ ] Quote builder with valid-until dates, customer selector, and PDF render.

### 14. Returns & Exchanges Module
- [ ] **Prisma Schema**: Define `ReturnTransaction` model.
- [ ] **API Routes**: `/api/transactions/:id/return` (atomic calculation of refund, inventory restock, and print log update).
- [ ] **Frontend Views**: Return processing wizard.
- [ ] **Components**:
  - [ ] Invoice return selection checklist showing active and previously returned quantities.

### 15. Expenses Module
- [ ] **Prisma Schema**: Define `Expense` model and categories.
- [ ] **API Routes**: `/api/expenses` (CRUD).
- [ ] **Frontend Views**: Expenses logging panel.
- [ ] **Components**:
  - [ ] Expenses log list with monthly category pie charts.

### 16. Reports Module
- [ ] **API Routes**: `/api/reports` (sales, purchases, inventory status, profit & loss, tax summaries).
- [ ] **Frontend Views**: Interactive reporting dashboard.
- [ ] **Components**:
  - [ ] CSV and PDF export handles for daily, weekly, or custom date ranges.
  - [ ] Cashier closing shift reconciliation metrics sheet.

### 17. Notifications Module
- [ ] **Prisma Schema**: Define `Notification` model.
- [ ] **Real-time Server**: Set up Server-Sent Events (SSE) or WebSockets in Next.js API.
- [ ] **Frontend Views**: Toast notifications and alert panels.
- [ ] **Components**:
  - [ ] Dropdown menu inside top header displaying low-stock and warehouse transfers alerts.

### 18. AI Assistant Module
- [ ] **API Routes**: `/api/ai/chat` (context-aware LLM query) and `/api/ai/forecast` (sales prediction).
- [ ] **Frontend Views**: Chat interface drawer.
- [ ] **Components**:
  - [ ] Floating AI Chat bubble enabling product lookup and sales trend explanations.

### 19. Settings Module
- [ ] **Prisma Schema**: Define `StoreSettings` table mapping store details and configurations.
- [ ] **API Routes**: `/api/settings` (GET/PUT).
- [ ] **Frontend Views**: Shop profile and system configuration panel.
- [ ] **Components**:
  - [ ] Multiple store profiles editor with branch-specific tax and invoice prefixes.

### 20. Audit Logs Module
- [ ] **Prisma Schema**: Define `AuditLog` table.
- [ ] **Backend Middleware**: Global request interceptor logging changes to sensitive tables.
- [ ] **Frontend Views**: System auditor table dashboard.
- [ ] **Components**:
  - [ ] Paginated log table with filters for User, Module, Date, and Severity.

---

## Premium Construction & Business Calculators

### 1. Premium Tile Calculator
- [ ] **Math Formula Engine**:
  $$\text{Room Area} = \text{Length} \times \text{Width}$$
  $$\text{Tile Area} = \text{Tile Length} \times \text{Tile Width}$$
  $$\text{Raw Tiles Required} = \frac{\text{Room Area}}{\text{Tile Area}}$$
  $$\text{Extra Waste Tiles} = \text{Raw Tiles} \times \text{Waste } \%$$
  $$\text{Total Tiles} = \text{Raw Tiles} + \text{Extra Waste Tiles}$$
  $$\text{Boxes Required} = \lceil \frac{\text{Total Tiles}}{\text{Tiles Per Box}} \rceil$$
  $$\text{Total Cost} = \text{Boxes Required} \times \text{Price Per Box}$$
  $$\text{Adhesive Estimate} = \text{Room Area} \times 0.15 \text{ bags (using custom ratio)}$$
  $$\text{Grout Estimate} = \text{Room Area} \times 0.1 \text{ kg (using custom ratio)}$$
- [ ] **Frontend Component**: Build `TileCalculator` view containing preset sizes (1x1 ft, 2x2 ft, 2x4 ft, 4x2 ft, 12x24 in, 24x24 in) and custom dimensions, showing room grid layout, waste percentage sliders, and a detailed material shopping list with a "Add to Cart" button for the POS.

### 2. Other Construction Calculators
- [ ] **Paint Calculator**: Input wall dimensions, doors, windows, and coats to output Liters of paint needed.
- [ ] **Cement & Concrete volume**: Input slab length, width, and thickness to output total cubic yards/meters and required cement bags, sand, and aggregate bags (1:2:4 ratio).
- [ ] **Brick & Block Calculator**: Input wall dimensions and block sizes to calculate total blocks and mortar bags.
- [ ] **Steel Weight Calculator**: Calculates reinforcement bar weight using formula: $W = D^2 / 162.2 \times L$ (Weight in kg, Diameter in mm, Length in meters).
- [ ] **Timber Volume**: Input dimensions to calculate volume in cubic feet (cft) and total price.
- [ ] **Pipe, Glass, & Roofing Sheet**: Dimensions mapping to calculate exact piece counts.

### 3. Business Calculators
- [ ] **Discount & VAT**: Fast discount deduction and tax computation.
- [ ] **Margin & Markup**: Margin % and markup prices from product cost inputs.
- [ ] **Delivery Cost & Customer Credit**: Proximity pricing and credit availability check.
- [ ] **Inventory Metrics**: Reorder Level, Safety Stock, and Economic Order Quantity ($EOQ = \sqrt{\frac{2 \times D \times S}{H}}$).

---

## User Roles & Permissions Matrix

| Role | Access Level | Permitted Modules |
| :--- | :--- | :--- |
| **Owner** | Full (Root) | All modules, system configs, audit logs, financials. |
| **Super Admin** | Full (Operations) | All modules, user creation, branch setups. |
| **Branch Manager** | Branch level | POS, inventory, customers, local reports. |
| **Cashier** | Terminal level | POS, returns, cash shifts. |
| **Inventory Manager** | Inventory level | Products, warehouses, transfers, suppliers. |
| **Warehouse Staff** | Logistics level | Stock transfers receiving, location stock count. |
| **Accountant** | Financial level | Expenses, purchase ledger, customer ledger, reports. |
| **Purchasing Officer** | Purchasing level | Purchase orders, suppliers. |
| **Sales Representative** | Sales level | POS, quotations, customers. |
| **Delivery Driver** | Delivery level | Outbound shipments, delivery logs. |

---

## Development Roadmap

### Phase 1: Authentication & Core Management
- Set up Next.js 15, Prisma ORM schema, and PostgreSQL database.
- Build JWT Authentication, signup, login, and user management screens.
- Build Products, Categories, Brands, and Units CRUD dashboard.

### Phase 2: POS, Cart, & Transactions
- Build POS terminal interface, cart state, barcode scanner, and payment popup.
- Integrate hold/resume sales, customer credit, and cashier shifts.
- Set up PDFKit receipt creation, email/WhatsApp sharing controllers.

### Phase 3: Inventory, Warehouses, & Purchases
- Build warehouse structures, stock log ledger, and inventory adjustments.
- Build supplier management and purchase order processing workflow.
- Build returns, refunds, and exchanges workflow.

### Phase 4: Reports, Calculators, & AI
- Build reports dashboard with CSV exports.
- Implement Tile Calculator and other construction calculators.
- Integrate Google Gemini AI for chat assistance and sales forecasting.

---

## Legacy System Setup & Running Instructions

> **Note**: While migrating, you can continue running the current Express + Vite application inside this directory.

### Prerequisites

- Node.js 20+
- PostgreSQL 14+

### Quick Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Copy `.env.example` to `.env.local` and configure your credentials.

3. **Database Creation**:
   Ensure PostgreSQL database exists (default `hardware_pos` or update `DATABASE_URL` in `.env.local`).

4. **Run Server**:
   ```bash
   npm run dev
   ```

### One-Command Windows Quick Start
- Run `Launch-Hardware-POS.vbs` or `Start-Hardware-POS.bat` to launch the database and the Express/Vite app.
- Run `Stop-Hardware-POS.bat` to stop the database and server.

### DB Scripts
- `npm run db:tables` - list database tables.
- `npm run db:data` - print current persisted collections.
- `npm run db:migrate:normalized` - run normalized schema migrations.
- `npm run db:migrate:product-image` - add images column to normalized products table.
- `npm run db:shell` - enter interactive SQL shell in the database container.

### Demo Logins (Default Fallback password: `ChangeMe123!`)
- `admin@hardwarepos.local` (Super Admin)
- `manager@hardwarepos.local` (Store Manager)
- `cashier@hardwarepos.local` (Cashier)
- `inventory@hardwarepos.local` (Inventory Staff)

## Linux Mint Cinnamon desktop installation

For a fresh local installation, keep this project in a permanent folder on the shop laptop.
Install Node.js 22 or newer with npm, Docker Engine with the Compose v2 plugin, Python 3,
Zenity and the standard Mint desktop utilities. Enable Docker Engine at boot and confirm
the shop's signed-in account can run `docker info` and `docker compose version`.
As that desktop user, run once from the project folder:

```bash
bash scripts/mint/install.sh
```

Open **ARS Hardware POS** from the desktop or applications menu. If Cinnamon asks, trust the
launcher on first use. On a fresh database, create the first administrator. Later clicks open
the sign-in screen or existing session once PostgreSQL and ARS are ready. Startup uses the
local build and a dedicated Docker volume. The installer requires internet for dependencies.
Keep the project folder and its private `.env.local` together. The Windows backup scheduler
requires a separate Linux implementation before use on this laptop.
