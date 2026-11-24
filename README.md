# personalFinance - Personal Cash Flow & Budget Tracker

A lightweight, single-page web application for managing personal finances using a double-entry inspired model. Built with modular Object-Oriented JavaScript (`FinanceStore`, `ExcelBackupService`, `ChartRenderer`, `FinanceApp`), a clean English UI (with full UTF-8 / Vietnamese input support), responsive desktop/mobile layout, Light/Dark themes, and Privacy Mode.

### 🚀 Key Features
*   **Dual-Account Management:** Two-column view separating **Assets** and **Expenses**; supports creating, renaming (`✎`), adjusting asset balances (`⚖`), and safe deletion with validation against accounts in use.
*   **Unified Transaction History:**
    *   Supports **Income (+)**, **Expense (-)**, and **Transfer (⇄)** transactions.
    *   Automatically merges paired ledger entries (including legacy `[Chi]`/`[Phân loại]` and `[Expense]`/`[Type]` pairs) into single rows that can be **edited** (`✎` / `Esc` to cancel) or **deleted together** (`✕`).
    *   Real-time **search** plus **transaction type** and **account** filters.
*   **Recurring Transactions:** Schedule repeating transactions (**Daily**, **Weekly**, **Monthly**, or **Yearly**) and record due entries in one click (`Record Due` or per-item `Record`).
*   **Monthly Financial Reports & Budgets:**
    *   Calculates **Monthly Income**, **Monthly Spending**, **Monthly Net Cashflow**, and cumulative **Asset Balances / Net Worth**.
    *   Configure **Monthly Budgets** (overall spending and per-category limits) with color-coded progress bars and over-budget alerts.
*   **Interactive Charts (Chart.js):**
    *   **Expenditure Allocation (Doughnut Chart):** Visualizes monthly spending breakdown by expense category.
    *   **6-Month Trend (Bar Chart):** Compares monthly income vs. spending across the trailing 6 months.
*   **Excel Backup & Restore (`.xlsx`):** Export transactions, accounts, budgets, and recurring rules to Excel (`SheetJS`) and restore cleanly from `.xlsx`/`.xls`.
*   **Privacy Mode, Dark Mode & Responsive Layout:** Toggleable amount masking (`👁 Hide` / `🙈 Show`), persistent Light/Dark theme, and adaptive portrait/mobile ordering keeping data entry at the top followed immediately by charts and reports.

### 🛠️ Tech Stack
*   **Frontend:** HTML5, CSS3 (CSS Variables, Flexbox/Grid, Responsive Media Queries), Object-Oriented Vanilla JavaScript (ES6 Classes).
*   **Data Visualization:** Chart.js (via CDN).
*   **Excel Export/Import:** SheetJS (`xlsx` via CDN).
*   **Storage:** Web Storage API (`localStorage`).
