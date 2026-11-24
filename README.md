# personalFinance - Personal Cash Flow & Budget Tracker

A lightweight, single-page web application for managing personal finances using a double-entry inspired model. Designed with a clean English interface (with full UTF-8 / Vietnamese text support for inputs and exports), responsive desktop/mobile layout, and Light/Dark themes.

### 🚀 Key Features
*   **Dual-Account Management:** Create, rename, adjust asset balances (`⚖`), and safely delete **Asset** accounts (Cash, Bank, etc.) and **Expense** categories, with validation against deleting accounts in use.
*   **Unified Transaction History:**
    *   Supports **Income (+)**, **Expense (-)**, and **Transfer (⇄)** transactions.
    *   Automatically merges paired ledger entries (Expense + Category, Transfer Out + Transfer In) into single history rows that can be **edited** or **deleted together** in one click.
    *   Includes real-time **search** (by description or account) and **transaction type filtering**.
*   **Recurring Transactions:** Schedule repeating transactions (**Daily**, **Weekly**, **Monthly**, or **Yearly**) and record due entries in one click.
*   **Monthly Financial Reports & Budgets:**
    *   Calculates **Monthly Income**, **Monthly Spending**, **Monthly Net Cashflow**, and cumulative **Asset Balances / Net Worth**.
    *   Configure **Monthly Budgets** (overall spending and per-category limits) with color-coded progress bars and over-budget alerts.
*   **Interactive Charts (Chart.js):**
    *   **Expenditure Allocation (Doughnut Chart):** Visualizes monthly spending breakdown by expense category.
    *   **6-Month Trend (Bar Chart):** Compares monthly income vs. spending across the trailing 6 months.
*   **Excel Backup & Restore (`.xlsx`):** Export all transactions, accounts, budgets, and recurring rules to an Excel workbook (`SheetJS`), and restore data cleanly from `.xlsx` / `.xls` files.
*   **Dark Mode & Responsive Layout:** Persistent Light/Dark theme toggle via `localStorage` and adaptive portrait/mobile ordering that keeps data entry at the top followed immediately by charts and reports.

### 🛠️ Tech Stack
*   **Frontend:** HTML5, CSS3 (CSS Variables, Flexbox, Responsive Media Queries), Vanilla JavaScript.
*   **Data Visualization:** Chart.js (via CDN).
*   **Excel Export/Import:** SheetJS (`xlsx` via CDN).
*   **Storage:** Web Storage API (`localStorage`).
