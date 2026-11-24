const OVERALL_BUDGET_KEY = '__total__';
const STORAGE_KEYS = {
    ACCOUNTS: 'accountList',
    DATA: 'financeData',
    BUDGETS: 'budgetMap',
    RECURRING: 'recurringRules',
    THEME: 'theme',
    PRIVACY: 'privacyMode'
};

const DEFAULT_ACCOUNTS = [
    { name: 'Cash', type: 'asset', id: 'cash' },
    { name: 'Bank', type: 'asset', id: 'bank' },
    { name: 'General', type: 'liability', id: 'general_exp' }
];

class Utils {
    static getLocalDateString(dateObj = new Date()) {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    static escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    static formatCurrency(amount, hidden = false, prefix = '') {
        if (hidden) return `${prefix}••••••đ`;
        return `${prefix}${Number(amount || 0).toLocaleString()}đ`;
    }

    static advanceDate(dateStr, frequency) {
        const [y, m, d] = dateStr.split('-').map(Number);
        if (frequency === 'daily') return Utils.getLocalDateString(new Date(y, m - 1, d + 1));
        if (frequency === 'weekly') return Utils.getLocalDateString(new Date(y, m - 1, d + 7));
        if (frequency === 'monthly') {
            const targetMonth = m; // next month index (0-based = m)
            const lastDay = new Date(y, targetMonth + 1, 0).getDate();
            return Utils.getLocalDateString(new Date(y, targetMonth, Math.min(d, lastDay)));
        }
        if (frequency === 'yearly') {
            const lastDay = new Date(y + 1, m, 0).getDate();
            return Utils.getLocalDateString(new Date(y + 1, m - 1, Math.min(d, lastDay)));
        }
        return dateStr;
    }

    static getRecentMonths(endMonthKey, count = 6) {
        const [yearStr, monthStr] = endMonthKey.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const months = [];
        for (let i = count - 1; i >= 0; i--) {
            const d = new Date(year, month - 1 - i, 1);
            months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        return months;
    }

    static normalizeExcelDate(val) {
        if (typeof val === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF) {
            const parsed = XLSX.SSF.parse_date_code(val);
            if (parsed && parsed.y && parsed.m && parsed.d) {
                return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
            }
        }
        if (val instanceof Date && !isNaN(val.getTime())) {
            return Utils.getLocalDateString(val);
        }
        const str = String(val ?? '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmy) {
            return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        }
        return '';
    }
}

class StorageService {
    static loadJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    static saveJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    static get(key, fallback = '') {
        return localStorage.getItem(key) ?? fallback;
    }

    static set(key, value) {
        localStorage.setItem(key, value);
    }
}

class FinanceStore {
    constructor() {
        this.accounts = StorageService.loadJson(STORAGE_KEYS.ACCOUNTS, DEFAULT_ACCOUNTS.map(a => ({ ...a })));
        this.dataByMonth = StorageService.loadJson(STORAGE_KEYS.DATA, {});
        this.budgets = StorageService.loadJson(STORAGE_KEYS.BUDGETS, {});
        this.recurringRules = StorageService.loadJson(STORAGE_KEYS.RECURRING, []);
        this.lastGeneratedId = 0;
        this.accountMap = new Map();
        this.rebuildAccountIndex();
    }

    nextUniqueId() {
        const candidate = Math.max(Date.now(), this.lastGeneratedId + 2);
        this.lastGeneratedId = candidate;
        return candidate;
    }

    rebuildAccountIndex() {
        this.accountMap.clear();
        this.accounts.forEach(a => this.accountMap.set(a.id, a));
    }

    getAccount(id) {
        return this.accountMap.get(id) || null;
    }

    getAccountName(id) {
        if (id === OVERALL_BUDGET_KEY) return 'Overall Monthly Spending';
        return this.accountMap.get(id)?.name || 'N/A';
    }

    getAccountsByType(type) {
        return this.accounts.filter(a => a.type === type);
    }

    saveAccounts() {
        this.rebuildAccountIndex();
        StorageService.saveJson(STORAGE_KEYS.ACCOUNTS, this.accounts);
    }

    saveTransactions() {
        StorageService.saveJson(STORAGE_KEYS.DATA, this.dataByMonth);
    }

    saveBudgets() {
        StorageService.saveJson(STORAGE_KEYS.BUDGETS, this.budgets);
    }

    saveRecurring() {
        StorageService.saveJson(STORAGE_KEYS.RECURRING, this.recurringRules);
    }

    // Account operations
    addAccount(name, type) {
        const trimmedName = name.trim();
        if (!trimmedName) return { ok: false, error: '' };

        const duplicate = this.accounts.some(
            a => a.type === type && a.name.trim().toLowerCase() === trimmedName.toLowerCase()
        );
        if (duplicate) {
            return { ok: false, error: 'This account already exists in the selected category.' };
        }

        this.accounts.push({ name: trimmedName, type, id: 'acc_' + this.nextUniqueId() });
        this.saveAccounts();
        return { ok: true };
    }

    renameAccount(id, proposedName) {
        const targetAcc = this.getAccount(id);
        if (!targetAcc) return { ok: false, error: '' };

        const trimmedName = proposedName.trim();
        if (!trimmedName) return { ok: false, error: 'Account name cannot be empty.' };

        const duplicate = this.accounts.some(
            a => a.id !== id && a.type === targetAcc.type && a.name.trim().toLowerCase() === trimmedName.toLowerCase()
        );
        if (duplicate) {
            return { ok: false, error: 'Another account with this name already exists in the same category.' };
        }

        targetAcc.name = trimmedName;
        this.saveAccounts();
        return { ok: true };
    }

    deleteAccount(id) {
        const targetAcc = this.getAccount(id);
        if (!targetAcc) return { ok: false, error: '' };

        if (this.getAccountsByType(targetAcc.type).length <= 1) {
            return {
                ok: false,
                error: `You must keep at least one ${targetAcc.type === 'asset' ? 'Asset' : 'Expense'} account.`
            };
        }

        const usedInTx = Object.values(this.dataByMonth).some(
            monthTxs => Array.isArray(monthTxs) && monthTxs.some(t => t.account === id)
        );
        if (usedInTx) {
            return {
                ok: false,
                error: 'Cannot delete this account because it is used in existing transactions. Please edit or delete those transactions first.'
            };
        }

        const usedInRecurring = this.recurringRules.some(r => r.accountId === id || r.targetId === id);
        if (usedInRecurring) {
            return {
                ok: false,
                error: 'Cannot delete this account because it is used in a Recurring rule. Please remove that rule first.'
            };
        }

        this.accounts = this.accounts.filter(a => a.id !== id);
        if (this.budgets[id]) {
            delete this.budgets[id];
            this.saveBudgets();
        }
        this.saveAccounts();
        return { ok: true };
    }

    adjustAssetBalance(id, actualBalance, dateVal) {
        const targetAcc = this.getAccount(id);
        if (!targetAcc || targetAcc.type !== 'asset') return { ok: false, error: '' };

        const currentBalance = this.computeAllAssetBalances()[id] || 0;
        const diff = actualBalance - currentBalance;
        if (diff === 0) return { ok: false, error: 'Balance is already up to date.' };

        const monthKey = dateVal.slice(0, 7);
        if (!this.dataByMonth[monthKey]) this.dataByMonth[monthKey] = [];
        this.dataByMonth[monthKey].push({
            id: this.nextUniqueId(),
            date: dateVal,
            desc: '[Adjust] Balance adjustment',
            amount: Math.abs(diff),
            type: diff > 0 ? 'income' : 'expense',
            account: id
        });
        this.saveTransactions();
        return { ok: true, monthKey };
    }

    // Transaction / ledger operations
    buildEntries({ dateVal, type, desc, amount, accountId, targetId }, idBase = null) {
        const baseId = idBase ?? this.nextUniqueId();
        if (type === 'income') {
            return [{ id: baseId, date: dateVal, desc, amount, type: 'income', account: accountId }];
        }
        if (type === 'expense') {
            if (!targetId) {
                return [{ id: baseId, date: dateVal, desc, amount, type: 'expense', account: accountId }];
            }
            return [
                { id: baseId, groupId: baseId, date: dateVal, desc: `[Expense] ${desc}`, amount, type: 'expense', account: accountId },
                { id: baseId + 1, groupId: baseId, date: dateVal, desc: `[Type] ${desc}`, amount, type: 'income', account: targetId }
            ];
        }
        if (type === 'transfer') {
            const srcName = this.getAccountName(accountId);
            const destName = this.getAccountName(targetId);
            return [
                { id: baseId, groupId: baseId, date: dateVal, desc: `[Move] ${desc} (To ${destName})`, amount, type: 'transfer_out', account: accountId },
                { id: baseId + 1, groupId: baseId, date: dateVal, desc: `[Get from] ${desc} (From ${srcName})`, amount, type: 'transfer_in', account: targetId }
            ];
        }
        return [];
    }

    insertTransaction(payload) {
        const monthKey = payload.dateVal.slice(0, 7);
        if (!this.dataByMonth[monthKey]) this.dataByMonth[monthKey] = [];
        const entries = this.buildEntries(payload);
        this.dataByMonth[monthKey].push(...entries);
        return monthKey;
    }

    deleteTransaction(monthKey, transactionIds) {
        const idsToDelete = Array.isArray(transactionIds) ? transactionIds : [transactionIds];
        this.dataByMonth[monthKey] = (this.dataByMonth[monthKey] || []).filter(t => !idsToDelete.includes(t.id));
        if (this.dataByMonth[monthKey].length === 0) delete this.dataByMonth[monthKey];
        this.saveTransactions();
    }

    groupTransactionsForHistory(monthKey) {
        const transactions = this.dataByMonth[monthKey] || [];
        const groups = [];
        const usedIndices = new Set();

        for (let i = 0; i < transactions.length; i++) {
            if (usedIndices.has(i)) continue;
            const t = transactions[i];
            let partnerIndex = -1;

            if (t.groupId !== undefined) {
                partnerIndex = transactions.findIndex(
                    (other, idx) => idx > i && !usedIndices.has(idx) && other.groupId === t.groupId
                );
            } else if (i + 1 < transactions.length && !usedIndices.has(i + 1)) {
                const next = transactions[i + 1];
                const isLegacyExpensePair =
                    t.type === 'expense' &&
                    next.type === 'income' &&
                    next.id === t.id + 1 &&
                    typeof next.desc === 'string' &&
                    (next.desc.startsWith('[Type] ') || next.desc.startsWith('[Phân loại] '));
                const isLegacyTransferPair =
                    t.type === 'transfer_out' &&
                    next.type === 'transfer_in' &&
                    next.id === t.id + 1;
                if (isLegacyExpensePair || isLegacyTransferPair) {
                    partnerIndex = i + 1;
                }
            }

            if (partnerIndex !== -1) {
                usedIndices.add(i);
                usedIndices.add(partnerIndex);
                const partner = transactions[partnerIndex];

                if (t.type === 'expense' || partner.type === 'expense') {
                    const exp = t.type === 'expense' ? t : partner;
                    const liab = t.type === 'expense' ? partner : t;
                    groups.push({
                        ids: [exp.id, liab.id],
                        txType: 'expense',
                        date: exp.date,
                        desc: exp.desc.replace(/^\[(Expense|Chi)\]\s*/, ''),
                        amount: exp.amount,
                        accountId: exp.account,
                        targetId: liab.account,
                        tag: `${this.getAccountName(exp.account)} → ${this.getAccountName(liab.account)}`,
                        sign: '-',
                        colorClass: 'red'
                    });
                    continue;
                }

                if (t.type === 'transfer_out' || partner.type === 'transfer_out') {
                    const outTx = t.type === 'transfer_out' ? t : partner;
                    const inTx = t.type === 'transfer_out' ? partner : t;
                    const cleanDesc = outTx.desc
                        .replace(/^\[Move\]\s*/, '')
                        .replace(/\s*\(To [^)]*\)$/, '');
                    groups.push({
                        ids: [outTx.id, inTx.id],
                        txType: 'transfer',
                        date: outTx.date,
                        desc: cleanDesc,
                        amount: outTx.amount,
                        accountId: outTx.account,
                        targetId: inTx.account,
                        tag: `${this.getAccountName(outTx.account)} → ${this.getAccountName(inTx.account)}`,
                        sign: '⇄ ',
                        colorClass: 'orange'
                    });
                    continue;
                }
            }

            usedIndices.add(i);
            let colorClass = 'blue';
            let sign = '+';
            if (t.type === 'expense') { colorClass = 'red'; sign = '-'; }
            if (t.type === 'transfer_out') { colorClass = 'orange'; sign = '-'; }
            if (t.type === 'transfer_in') { colorClass = 'orange'; sign = '+'; }

            groups.push({
                ids: [t.id],
                txType: t.type,
                date: t.date,
                desc: t.desc,
                amount: t.amount,
                accountId: t.account,
                targetId: '',
                tag: this.getAccountName(t.account),
                sign,
                colorClass
            });
        }

        return groups.sort((a, b) => {
            const dateCmp = (b.date || '').localeCompare(a.date || '');
            if (dateCmp !== 0) return dateCmp;
            return Math.max(...b.ids) - Math.max(...a.ids);
        });
    }

    // Reporting computations (O(1) account lookups via accountMap)
    computeAllAssetBalances() {
        const balances = {};
        this.accounts.forEach(a => {
            balances[a.id] = 0;
        });

        Object.keys(this.dataByMonth).forEach(month => {
            (this.dataByMonth[month] || []).forEach(t => {
                if (!this.accountMap.has(t.account)) return;
                if (t.type === 'income' || t.type === 'transfer_in') {
                    balances[t.account] += t.amount;
                } else if (t.type === 'expense' || t.type === 'transfer_out') {
                    balances[t.account] -= t.amount;
                }
            });
        });

        return balances;
    }

    computeMonthlySummary(monthKey) {
        let income = 0;
        let expense = 0;
        const expenseByCategory = {};

        this.accounts.forEach(a => {
            if (a.type === 'liability') expenseByCategory[a.id] = 0;
        });

        (this.dataByMonth[monthKey] || []).forEach(t => {
            const accInfo = this.getAccount(t.account);
            if (!accInfo) return;

            if (t.type === 'income') {
                if (accInfo.type === 'asset') income += t.amount;
                if (accInfo.type === 'liability') {
                    expenseByCategory[t.account] = (expenseByCategory[t.account] || 0) + t.amount;
                }
            } else if (t.type === 'expense') {
                expense += t.amount;
            }
        });

        return { income, expense, expenseByCategory };
    }

    // Budget operations
    setBudget(targetId, limit) {
        if (limit === 0) {
            delete this.budgets[targetId];
        } else {
            this.budgets[targetId] = limit;
        }
        this.saveBudgets();
    }

    removeBudget(targetId) {
        delete this.budgets[targetId];
        this.saveBudgets();
    }

    getActiveBudgets() {
        return Object.entries(this.budgets).filter(
            ([key, limit]) =>
                limit > 0 &&
                (key === OVERALL_BUDGET_KEY || (this.getAccount(key)?.type === 'liability'))
        );
    }

    // Recurring operations
    addRecurringRule({ type, desc, accountId, targetId, amount, frequency, startDate }) {
        this.recurringRules.push({
            id: 'rec_' + this.nextUniqueId(),
            type,
            desc,
            accountId,
            targetId,
            amount,
            frequency,
            nextDate: Utils.advanceDate(startDate, frequency)
        });
        this.saveRecurring();
    }

    deleteRecurringRule(ruleId) {
        this.recurringRules = this.recurringRules.filter(r => r.id !== ruleId);
        this.saveRecurring();
    }

    hasValidAccounts(rule) {
        const srcExists = this.accountMap.has(rule.accountId);
        const targetExists = !rule.targetId || this.accountMap.has(rule.targetId);
        return srcExists && targetExists;
    }

    recordDueRecurring(currentToday) {
        let recordedCount = 0;
        this.recurringRules.forEach(rule => {
            if (!this.hasValidAccounts(rule)) return;
            while (rule.nextDate && rule.nextDate <= currentToday) {
                this.insertTransaction({
                    dateVal: rule.nextDate,
                    type: rule.type,
                    desc: rule.desc,
                    amount: rule.amount,
                    accountId: rule.accountId,
                    targetId: rule.targetId
                });
                rule.nextDate = Utils.advanceDate(rule.nextDate, rule.frequency);
                recordedCount++;
            }
        });

        if (recordedCount > 0) {
            this.saveTransactions();
            this.saveRecurring();
        }
        return recordedCount;
    }

    recordSingleRecurring(ruleId, fallbackDate) {
        const rule = this.recurringRules.find(r => r.id === ruleId);
        if (!rule) return { ok: false, error: '' };
        if (!this.hasValidAccounts(rule)) {
            return { ok: false, error: 'One of the accounts in this recurring rule no longer exists.' };
        }

        const recordDate = rule.nextDate || fallbackDate;
        this.insertTransaction({
            dateVal: recordDate,
            type: rule.type,
            desc: rule.desc,
            amount: rule.amount,
            accountId: rule.accountId,
            targetId: rule.targetId
        });
        rule.nextDate = Utils.advanceDate(recordDate, rule.frequency);

        this.saveTransactions();
        this.saveRecurring();
        return { ok: true, monthKey: recordDate.slice(0, 7) };
    }
}

class ExcelBackupService {
    static appendSheet(wb, name, rows, emptyRow, colWidths) {
        const sheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [emptyRow]);
        sheet['!cols'] = colWidths.map(wch => ({ wch }));
        XLSX.utils.book_append_sheet(wb, sheet, name);
    }

    static exportWorkbook(store) {
        if (typeof XLSX === 'undefined') {
            alert('Excel library failed to load. Please check your internet connection.');
            return false;
        }

        const transactionRows = [];
        Object.keys(store.dataByMonth).sort().forEach(month => {
            store.groupTransactionsForHistory(month).forEach(item => {
                transactionRows.push({
                    Date: item.date,
                    Type: item.txType,
                    Description: item.desc,
                    Account: store.getAccountName(item.accountId),
                    Target: item.targetId ? store.getAccountName(item.targetId) : '',
                    Amount: item.amount,
                    AccountId: item.accountId,
                    TargetId: item.targetId || ''
                });
            });
        });
        transactionRows.sort((a, b) => a.Date.localeCompare(b.Date));

        const accountRows = store.accounts.map(a => ({ ID: a.id, Name: a.name, Type: a.type }));
        const budgetRows = store.getActiveBudgets().map(([targetId, limit]) => ({
            TargetId: targetId,
            TargetName: store.getAccountName(targetId),
            Limit: limit
        }));
        const recurringRows = store.recurringRules.map(rule => ({
            ID: rule.id,
            Type: rule.type,
            Description: rule.desc,
            Account: store.getAccountName(rule.accountId),
            Target: rule.targetId ? store.getAccountName(rule.targetId) : '',
            Amount: rule.amount,
            Frequency: rule.frequency,
            NextDate: rule.nextDate,
            AccountId: rule.accountId,
            TargetId: rule.targetId || ''
        }));

        const wb = XLSX.utils.book_new();
        ExcelBackupService.appendSheet(
            wb, 'Transactions', transactionRows,
            { Date: '', Type: '', Description: '', Account: '', Target: '', Amount: '', AccountId: '', TargetId: '' },
            [12, 10, 28, 18, 18, 14, 18, 18]
        );
        ExcelBackupService.appendSheet(
            wb, 'Accounts', accountRows,
            { ID: '', Name: '', Type: '' },
            [20, 22, 12]
        );
        ExcelBackupService.appendSheet(
            wb, 'Budgets', budgetRows,
            { TargetId: '', TargetName: '', Limit: '' },
            [20, 24, 14]
        );
        ExcelBackupService.appendSheet(
            wb, 'Recurring', recurringRows,
            { ID: '', Type: '', Description: '', Account: '', Target: '', Amount: '', Frequency: '', NextDate: '', AccountId: '', TargetId: '' },
            [18, 10, 24, 18, 18, 14, 10, 12, 18, 18]
        );

        XLSX.writeFile(wb, `personal-finance-backup-${Utils.getLocalDateString()}.xlsx`);
        return true;
    }

    static resolveOrCreateAccount(accounts, idCandidate, nameCandidate, expectedType, seedRef) {
        if (idCandidate) {
            const byId = accounts.find(a => a.id === String(idCandidate).trim());
            if (byId) return byId;
        }
        const cleanName = String(nameCandidate ?? '').trim();
        if (cleanName) {
            const byName = accounts.find(
                a => a.name.trim().toLowerCase() === cleanName.toLowerCase() && (!expectedType || a.type === expectedType)
            );
            if (byName) return byName;

            const created = {
                id: idCandidate ? String(idCandidate).trim() : `acc_${seedRef.value++}`,
                name: cleanName,
                type: expectedType || 'asset'
            };
            accounts.push(created);
            return created;
        }
        return accounts.find(a => a.type === (expectedType || 'asset')) || null;
    }

    static parseWorkbook(arrayBuffer, fallbackAccounts, store) {
        const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        const hasTransactionsSheet = workbook.SheetNames.includes('Transactions');
        const hasAccountsSheet = workbook.SheetNames.includes('Accounts');
        if (!hasTransactionsSheet && !hasAccountsSheet) {
            throw new Error('Invalid backup file: missing "Transactions" or "Accounts" sheet.');
        }

        let importedAccounts = [];
        if (hasAccountsSheet) {
            const rawAccounts = XLSX.utils.sheet_to_json(workbook.Sheets['Accounts'], { defval: '' });
            rawAccounts.forEach((row, idx) => {
                const name = String(row.Name ?? '').trim();
                const type = String(row.Type ?? '').trim().toLowerCase();
                if (name && (type === 'asset' || type === 'liability')) {
                    importedAccounts.push({
                        id: String(row.ID || `acc_imp_${Date.now()}_${idx}`),
                        name,
                        type
                    });
                }
            });
        }
        if (importedAccounts.length === 0) {
            importedAccounts = fallbackAccounts.map(a => ({ ...a }));
        }

        const rawTxs = hasTransactionsSheet
            ? XLSX.utils.sheet_to_json(workbook.Sheets['Transactions'], { defval: '' })
            : [];
        const hasNonEmptyTxRow = rawTxs.some(
            row => String(row.Date ?? '').trim() !== '' ||
                String(row.Amount ?? '').trim() !== '' ||
                String(row.Description ?? '').trim() !== ''
        );

        const importedData = {};
        const seed = { value: Date.now() };
        let importedCount = 0;

        for (let i = 0; i < rawTxs.length; i++) {
            const row = rawTxs[i];
            const dateStr = Utils.normalizeExcelDate(row.Date);
            const txType = String(row.Type ?? '').trim().toLowerCase();
            const desc = String(row.Description ?? '').trim();
            const amount = parseFloat(row.Amount);

            if (!dateStr || !txType || isNaN(amount) || amount <= 0) continue;

            const monthKey = dateStr.slice(0, 7);
            if (!importedData[monthKey]) importedData[monthKey] = [];
            const baseId = seed.value;
            seed.value += 2;

            // Auto-merge legacy ungrouped [Chi] + [Phân loại] rows
            if (txType === 'expense' && desc.startsWith('[Chi] ') && !row.Target && !row.TargetId && i + 1 < rawTxs.length) {
                const nextRow = rawTxs[i + 1];
                const nextDate = Utils.normalizeExcelDate(nextRow.Date);
                const nextType = String(nextRow.Type ?? '').trim().toLowerCase();
                const nextDesc = String(nextRow.Description ?? '').trim();
                const nextAmount = parseFloat(nextRow.Amount);
                if (nextDate === dateStr && nextType === 'income' && nextAmount === amount && nextDesc.startsWith('[Phân loại] ')) {
                    const srcAcc = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    const catAcc = ExcelBackupService.resolveOrCreateAccount(importedAccounts, nextRow.AccountId, nextRow.Account, 'liability', seed);
                    if (srcAcc && catAcc) {
                        const cleanDesc = desc.replace(/^\[Chi\]\s*/, '');
                        importedData[monthKey].push(...store.buildEntries({
                            dateVal: dateStr, type: 'expense', desc: cleanDesc, amount, accountId: srcAcc.id, targetId: catAcc.id
                        }, baseId));
                        importedCount++;
                        i++;
                        continue;
                    }
                }
            }

            if (txType === 'income') {
                const acc = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                if (!acc) continue;
                importedData[monthKey].push({ id: baseId, date: dateStr, desc: desc || 'Income', amount, type: 'income', account: acc.id });
                importedCount++;
            } else if (txType === 'expense') {
                const srcAcc = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                if (!srcAcc) continue;
                const hasTarget = String(row.TargetId ?? '').trim() !== '' || String(row.Target ?? '').trim() !== '';
                const catAcc = hasTarget
                    ? ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'liability', seed)
                    : null;
                importedData[monthKey].push(...store.buildEntries({
                    dateVal: dateStr, type: 'expense', desc: desc || 'Expense', amount, accountId: srcAcc.id, targetId: catAcc ? catAcc.id : ''
                }, baseId));
                importedCount++;
            } else if (txType === 'transfer') {
                const srcAcc = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                const destAcc = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'asset', seed);
                if (!srcAcc || !destAcc || srcAcc.id === destAcc.id) continue;
                importedData[monthKey].push(
                    { id: baseId, groupId: baseId, date: dateStr, desc: `[Move] ${desc || 'Transfer'} (To ${destAcc.name})`, amount, type: 'transfer_out', account: srcAcc.id },
                    { id: baseId + 1, groupId: baseId, date: dateStr, desc: `[Get from] ${desc || 'Transfer'} (From ${srcAcc.name})`, amount, type: 'transfer_in', account: destAcc.id }
                );
                importedCount++;
            } else if (txType === 'transfer_out' || txType === 'transfer_in') {
                const acc = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                if (!acc) continue;
                importedData[monthKey].push({ id: baseId, date: dateStr, desc: desc || 'Transfer', amount, type: txType, account: acc.id });
                importedCount++;
            }
        }

        if (hasNonEmptyTxRow && importedCount === 0) {
            throw new Error('No valid transactions found in the "Transactions" sheet.');
        }

        let importedBudgets = null;
        if (workbook.SheetNames.includes('Budgets')) {
            importedBudgets = {};
            const rawBudgets = XLSX.utils.sheet_to_json(workbook.Sheets['Budgets'], { defval: '' });
            rawBudgets.forEach(row => {
                const limit = parseFloat(row.Limit);
                if (isNaN(limit) || limit <= 0) return;
                const rawId = String(row.TargetId ?? '').trim();
                if (rawId === OVERALL_BUDGET_KEY) {
                    importedBudgets[OVERALL_BUDGET_KEY] = limit;
                    return;
                }
                const acc = ExcelBackupService.resolveOrCreateAccount(importedAccounts, rawId, row.TargetName, 'liability', seed);
                if (acc) importedBudgets[acc.id] = limit;
            });
        }

        let importedRecurring = null;
        if (workbook.SheetNames.includes('Recurring')) {
            importedRecurring = [];
            const rawRecurring = XLSX.utils.sheet_to_json(workbook.Sheets['Recurring'], { defval: '' });
            const validFreqs = ['daily', 'weekly', 'monthly', 'yearly'];
            rawRecurring.forEach((row, idx) => {
                const txType = String(row.Type ?? '').trim().toLowerCase();
                const desc = String(row.Description ?? '').trim();
                const amount = parseFloat(row.Amount);
                const frequency = String(row.Frequency ?? '').trim().toLowerCase();
                const nextDate = Utils.normalizeExcelDate(row.NextDate) || Utils.getLocalDateString();
                if (!desc || isNaN(amount) || amount <= 0 || !validFreqs.includes(frequency)) return;

                if (txType === 'income') {
                    const acc = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    if (acc) importedRecurring.push({ id: String(row.ID || `rec_imp_${Date.now()}_${idx}`), type: 'income', desc, accountId: acc.id, targetId: '', amount, frequency, nextDate });
                } else if (txType === 'expense') {
                    const src = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    const cat = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'liability', seed);
                    if (src && cat) importedRecurring.push({ id: String(row.ID || `rec_imp_${Date.now()}_${idx}`), type: 'expense', desc, accountId: src.id, targetId: cat.id, amount, frequency, nextDate });
                } else if (txType === 'transfer') {
                    const src = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.AccountId, row.Account, 'asset', seed);
                    const dest = ExcelBackupService.resolveOrCreateAccount(importedAccounts, row.TargetId, row.Target, 'asset', seed);
                    if (src && dest && src.id !== dest.id) importedRecurring.push({ id: String(row.ID || `rec_imp_${Date.now()}_${idx}`), type: 'transfer', desc, accountId: src.id, targetId: dest.id, amount, frequency, nextDate });
                }
            });
        }

        return { importedAccounts, importedData, importedBudgets, importedRecurring, importedCount };
    }
}

class ChartRenderer {
    constructor() {
        this.expenseChart = null;
        this.trendChart = null;
    }

    getThemeColors() {
        const isDark = document.body.classList.contains('dark-mode');
        return {
            textColor: isDark ? '#c1cad4' : '#444444',
            gridColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'
        };
    }

    renderExpenseDoughnut(labels, data, privacyMode) {
        const canvas = document.getElementById('expenseChart');
        const emptyMsg = document.getElementById('chart-empty-msg');
        if (!canvas || typeof Chart === 'undefined') return;

        if (this.expenseChart) {
            this.expenseChart.destroy();
            this.expenseChart = null;
        }

        if (labels.length === 0) {
            canvas.style.display = 'none';
            if (emptyMsg) emptyMsg.style.display = 'block';
            return;
        }

        canvas.style.display = 'block';
        if (emptyMsg) emptyMsg.style.display = 'none';

        const { textColor } = this.getThemeColors();
        this.expenseChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: ['#ff6384', '#36a2eb', '#cc65fe', '#ffce56', '#4bc0c0', '#f67019'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { color: textColor } },
                    title: { display: true, text: 'Expenditure allocation', color: textColor },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${Utils.formatCurrency(ctx.parsed, privacyMode)}`
                        }
                    }
                }
            }
        });
    }

    renderTrendBar(endMonthKey, store, privacyMode) {
        const canvas = document.getElementById('trendChart');
        if (!canvas || typeof Chart === 'undefined') return;

        if (this.trendChart) {
            this.trendChart.destroy();
            this.trendChart = null;
        }

        const recentMonths = Utils.getRecentMonths(endMonthKey, 6);
        const labels = recentMonths.map(m => {
            const [y, mm] = m.split('-');
            return `${mm}/${y.slice(2)}`;
        });
        const incomeSeries = recentMonths.map(m => store.computeMonthlySummary(m).income);
        const expenseSeries = recentMonths.map(m => store.computeMonthlySummary(m).expense);

        const { textColor, gridColor } = this.getThemeColors();
        this.trendChart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Income', data: incomeSeries, backgroundColor: 'rgba(2, 117, 216, 0.75)', borderRadius: 4 },
                    { label: 'Spending', data: expenseSeries, backgroundColor: 'rgba(217, 83, 79, 0.75)', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: textColor }, grid: { color: gridColor } },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: textColor,
                            callback: (value) => Utils.formatCurrency(value, privacyMode)
                        },
                        grid: { color: gridColor }
                    }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { color: textColor } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${Utils.formatCurrency(ctx.parsed.y, privacyMode)}`
                        }
                    }
                }
            }
        });
    }
}

class FinanceApp {
    constructor() {
        this.store = new FinanceStore();
        this.charts = new ChartRenderer();
        this.editingState = null;
        this.privacyMode = StorageService.get(STORAGE_KEYS.PRIVACY, 'false') === 'true';

        this.dom = {
            form: document.getElementById('finance-form'),
            txType: document.getElementById('transaction-type'),
            accountLabel: document.getElementById('account-label'),
            assetSelect: document.getElementById('account-type-select'),
            liabilityGroup: document.getElementById('liability-group'),
            liabilitySelect: document.getElementById('liability-account-select'),
            transferContainer: document.getElementById('transfer-destination-container'),
            transferSelect: document.getElementById('transfer-destination-select'),
            dateInput: document.getElementById('date-input'),
            descInput: document.getElementById('desc'),
            amountInput: document.getElementById('amount'),
            recurringOptionRow: document.getElementById('recurring-option-row'),
            isRecurring: document.getElementById('is-recurring'),
            recurringFreq: document.getElementById('recurring-frequency'),
            editBanner: document.getElementById('edit-banner'),
            submitBtn: document.getElementById('submit-btn'),
            cancelEditBtn: document.getElementById('cancel-edit-btn'),
            monthFilter: document.getElementById('month-filter'),
            historySearch: document.getElementById('history-search'),
            historyTypeFilter: document.getElementById('history-type-filter'),
            historyAccountFilter: document.getElementById('history-account-filter'),
            txList: document.getElementById('transaction-list'),
            recurringList: document.getElementById('recurring-list'),
            recordDueBtn: document.getElementById('record-due-btn'),
            budgetSelect: document.getElementById('budget-target-select'),
            budgetAmount: document.getElementById('budget-amount-input'),
            budgetList: document.getElementById('budget-list-manage'),
            newAccName: document.getElementById('new-account-name'),
            newAccType: document.getElementById('new-account-type'),
            assetAccList: document.getElementById('asset-account-list'),
            expenseAccList: document.getElementById('expense-account-list'),
            reportTitle: document.getElementById('current-view-title'),
            reportContent: document.getElementById('balance-sheet-content'),
            budgetProgressSection: document.getElementById('budget-progress-section'),
            totalSum: document.getElementById('total-sum'),
            themeBtn: document.getElementById('theme-toggle-btn'),
            privacyBtn: document.getElementById('privacy-toggle-btn'),
            excelInput: document.getElementById('excel-import-input')
        };
    }

    init() {
        const today = Utils.getLocalDateString();
        this.dom.dateInput.value = today;
        if (!this.dom.monthFilter.value) this.dom.monthFilter.value = today.slice(0, 7);

        this.applySavedTheme();
        this.updatePrivacyButton();
        this.bindEvents();
        this.refreshAll();
        this.toggleAccountSelect();
    }

    getSelectedMonth() {
        if (!this.dom.monthFilter.value) {
            this.dom.monthFilter.value = Utils.getLocalDateString().slice(0, 7);
        }
        return this.dom.monthFilter.value;
    }

    setSelectIfValid(selectEl, value) {
        if (value && [...selectEl.options].some(opt => opt.value === value)) {
            selectEl.value = value;
        }
    }

    bindEvents() {
        this.dom.themeBtn.addEventListener('click', () => this.toggleTheme());
        this.dom.privacyBtn.addEventListener('click', () => this.togglePrivacy());

        this.dom.txType.addEventListener('change', () => this.toggleAccountSelect());
        this.dom.isRecurring.addEventListener('change', () => this.toggleRecurringSelect());
        this.dom.cancelEditBtn.addEventListener('click', () => this.cancelEdit());
        this.dom.form.addEventListener('submit', (e) => this.handleFormSubmit(e));

        this.dom.monthFilter.addEventListener('change', () => this.renderUI());
        this.dom.historySearch.addEventListener('input', () => this.renderUI());
        this.dom.historyTypeFilter.addEventListener('change', () => this.renderUI());
        this.dom.historyAccountFilter.addEventListener('change', () => this.renderUI());

        this.dom.recordDueBtn.addEventListener('click', () => this.handleRecordDue());
        document.getElementById('save-budget-btn').addEventListener('click', () => this.handleSaveBudget());
        document.getElementById('add-account-btn').addEventListener('click', () => this.handleAddAccount());

        document.getElementById('export-excel-btn').addEventListener('click', () => {
            ExcelBackupService.exportWorkbook(this.store);
        });
        document.getElementById('import-excel-btn').addEventListener('click', () => {
            if (typeof XLSX === 'undefined') {
                alert('Excel library failed to load. Please check your internet connection.');
                return;
            }
            this.dom.excelInput.value = '';
            this.dom.excelInput.click();
        });
        this.dom.excelInput.addEventListener('change', (e) => this.handleImportExcel(e));

        // Delegated click handlers for dynamic lists
        this.dom.txList.addEventListener('click', (e) => this.handleHistoryAction(e));
        this.dom.recurringList.addEventListener('click', (e) => this.handleRecurringAction(e));
        this.dom.budgetList.addEventListener('click', (e) => this.handleBudgetAction(e));
        this.dom.assetAccList.addEventListener('click', (e) => this.handleAccountAction(e));
        this.dom.expenseAccList.addEventListener('click', (e) => this.handleAccountAction(e));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.editingState) {
                this.cancelEdit();
            }
        });
    }

    // Theme & Privacy
    applySavedTheme() {
        const isDark = StorageService.get(STORAGE_KEYS.THEME, 'light') === 'dark';
        document.body.classList.toggle('dark-mode', isDark);
        this.dom.themeBtn.innerText = isDark ? '☀️ Light' : '🌙 Dark';
    }

    toggleTheme() {
        const isDark = document.body.classList.toggle('dark-mode');
        StorageService.set(STORAGE_KEYS.THEME, isDark ? 'dark' : 'light');
        this.dom.themeBtn.innerText = isDark ? '☀️ Light' : '🌙 Dark';
        this.renderUI();
    }

    updatePrivacyButton() {
        this.dom.privacyBtn.innerText = this.privacyMode ? '🙈 Show' : '👁 Hide';
    }

    togglePrivacy() {
        this.privacyMode = !this.privacyMode;
        StorageService.set(STORAGE_KEYS.PRIVACY, String(this.privacyMode));
        this.updatePrivacyButton();
        this.renderRecurringList();
        this.renderBudgetsManager();
        this.renderUI();
    }

    // Form helpers
    toggleAccountSelect() {
        const type = this.dom.txType.value;
        if (type === 'expense') {
            this.dom.accountLabel.innerText = 'Withdraw from (Original account):';
            this.dom.liabilityGroup.style.display = 'block';
            this.dom.transferContainer.style.display = 'none';
        } else if (type === 'transfer') {
            this.dom.accountLabel.innerText = 'From (Source account):';
            this.dom.liabilityGroup.style.display = 'none';
            this.dom.transferContainer.style.display = 'block';
        } else {
            this.dom.accountLabel.innerText = 'To (Account):';
            this.dom.liabilityGroup.style.display = 'none';
            this.dom.transferContainer.style.display = 'none';
        }
    }

    toggleRecurringSelect() {
        this.dom.recurringFreq.style.display = this.dom.isRecurring.checked ? 'inline-block' : 'none';
    }

    handleFormSubmit(e) {
        e.preventDefault();
        const dateVal = this.dom.dateInput.value;
        const monthKey = dateVal.slice(0, 7);
        const type = this.dom.txType.value;
        const amount = parseFloat(this.dom.amountInput.value);
        const desc = this.dom.descInput.value.trim();
        const accountId = this.dom.assetSelect.value;
        const targetId = type === 'expense'
            ? this.dom.liabilitySelect.value
            : (type === 'transfer' ? this.dom.transferSelect.value : '');
        const isRecurring = this.dom.isRecurring.checked;
        const frequency = this.dom.recurringFreq.value;

        if (!dateVal || !desc) {
            alert('Please fill in all required fields.');
            return;
        }
        if (isNaN(amount) || amount <= 0) {
            alert('Amount must be greater than 0.');
            return;
        }
        if (type === 'transfer' && accountId === targetId) {
            alert('The source and destination accounts must not be the same!');
            return;
        }

        if (this.editingState) {
            this.store.deleteTransaction(this.editingState.monthKey, this.editingState.ids);
        }

        this.store.insertTransaction({ dateVal, type, desc, amount, accountId, targetId });
        this.store.saveTransactions();

        if (!this.editingState && isRecurring) {
            this.store.addRecurringRule({ type, desc, accountId, targetId, amount, frequency, startDate: dateVal });
        }

        this.dom.monthFilter.value = monthKey;
        this.cancelEdit();
        this.renderRecurringList();
        this.renderUI();
    }

    startEditTransaction(monthKey, ids) {
        const items = this.store.groupTransactionsForHistory(monthKey);
        const item = items.find(entry => entry.ids.join(',') === ids.join(','));
        if (!item) return;

        const editableType = (item.txType === 'transfer_out' || item.txType === 'transfer_in')
            ? 'transfer'
            : item.txType;

        this.dom.txType.value = editableType;
        this.toggleAccountSelect();

        this.setSelectIfValid(this.dom.assetSelect, item.accountId);
        if (editableType === 'expense') {
            this.setSelectIfValid(this.dom.liabilitySelect, item.targetId);
        } else if (editableType === 'transfer') {
            this.setSelectIfValid(this.dom.transferSelect, item.targetId);
        }

        this.dom.dateInput.value = item.date;
        this.dom.descInput.value = item.desc;
        this.dom.amountInput.value = item.amount;

        this.editingState = { monthKey, ids: item.ids };
        this.dom.editBanner.style.display = 'block';
        this.dom.recurringOptionRow.style.display = 'none';
        this.dom.isRecurring.checked = false;
        this.toggleRecurringSelect();
        this.dom.submitBtn.innerText = 'Save changes';
        this.dom.cancelEditBtn.style.display = 'inline-block';
        this.dom.form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    cancelEdit() {
        this.editingState = null;
        this.dom.form.reset();
        this.dom.dateInput.value = Utils.getLocalDateString();
        this.dom.editBanner.style.display = 'none';
        this.dom.recurringOptionRow.style.display = 'flex';
        this.dom.isRecurring.checked = false;
        this.toggleRecurringSelect();
        this.dom.submitBtn.innerText = 'Add';
        this.dom.cancelEditBtn.style.display = 'none';
        this.toggleAccountSelect();
    }

    // Delegated action handlers
    handleHistoryAction(e) {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const monthKey = btn.dataset.month;
        const ids = btn.dataset.ids.split(',').map(Number);

        if (btn.dataset.action === 'edit') {
            this.startEditTransaction(monthKey, ids);
        } else if (btn.dataset.action === 'delete') {
            if (!confirm('Are you sure you want to delete this transaction?')) return;
            if (this.editingState && this.editingState.monthKey === monthKey && this.editingState.ids.some(id => ids.includes(id))) {
                this.cancelEdit();
            }
            this.store.deleteTransaction(monthKey, ids);
            this.renderUI();
        }
    }

    handleRecurringAction(e) {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const ruleId = btn.dataset.id;

        if (btn.dataset.action === 'record') {
            const res = this.store.recordSingleRecurring(ruleId, Utils.getLocalDateString());
            if (!res.ok) {
                if (res.error) alert(res.error);
                return;
            }
            this.dom.monthFilter.value = res.monthKey;
            this.renderRecurringList();
            this.renderUI();
        } else if (btn.dataset.action === 'delete') {
            if (!confirm('Remove this recurring transaction?')) return;
            this.store.deleteRecurringRule(ruleId);
            this.renderRecurringList();
        }
    }

    handleRecordDue() {
        const recorded = this.store.recordDueRecurring(Utils.getLocalDateString());
        if (recorded === 0) {
            alert('No recurring transactions are due up to today.');
            return;
        }
        this.renderRecurringList();
        this.renderUI();
    }

    handleSaveBudget() {
        const targetId = this.dom.budgetSelect.value;
        const amount = parseFloat(this.dom.budgetAmount.value);
        if (!targetId) return;
        if (isNaN(amount) || amount < 0) {
            alert('Please enter a valid budget limit (0 or higher).');
            return;
        }
        this.store.setBudget(targetId, amount);
        this.dom.budgetAmount.value = '';
        this.renderBudgetsManager();
        this.renderUI();
    }

    handleBudgetAction(e) {
        const btn = e.target.closest('button[data-action="remove-budget"]');
        if (!btn) return;
        this.store.removeBudget(btn.dataset.id);
        this.renderBudgetsManager();
        this.renderUI();
    }

    handleAddAccount() {
        const res = this.store.addAccount(this.dom.newAccName.value, this.dom.newAccType.value);
        if (!res.ok) {
            if (res.error) alert(res.error);
            return;
        }
        this.dom.newAccName.value = '';
        this.refreshAll();
    }

    handleAccountAction(e) {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.dataset.id;

        if (btn.dataset.action === 'adjust') {
            const acc = this.store.getAccount(id);
            if (!acc) return;
            const currentBalance = this.store.computeAllAssetBalances()[id] || 0;
            const input = prompt(
                `Current balance for "${acc.name}": ${Utils.formatCurrency(currentBalance, false)}\nEnter actual balance (VND):`,
                currentBalance
            );
            if (input === null) return;
            const actualBalance = parseFloat(input.replace(/,/g, '').trim());
            if (isNaN(actualBalance) || !isFinite(actualBalance)) {
                alert('Please enter a valid number.');
                return;
            }
            const res = this.store.adjustAssetBalance(id, actualBalance, this.dom.dateInput.value || Utils.getLocalDateString());
            if (!res.ok) {
                if (res.error) alert(res.error);
                return;
            }
            this.dom.monthFilter.value = res.monthKey;
            this.renderUI();
        } else if (btn.dataset.action === 'rename') {
            const acc = this.store.getAccount(id);
            if (!acc) return;
            const proposed = prompt('Enter new account name:', acc.name);
            if (proposed === null) return;
            const res = this.store.renameAccount(id, proposed);
            if (!res.ok) {
                if (res.error) alert(res.error);
                return;
            }
            this.refreshAll();
        } else if (btn.dataset.action === 'delete') {
            if (!confirm('Delete this account?')) return;
            const res = this.store.deleteAccount(id);
            if (!res.ok) {
                if (res.error) alert(res.error);
                return;
            }
            this.refreshAll();
        }
    }

    handleImportExcel(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = ExcelBackupService.parseWorkbook(e.target.result, this.store.accounts, this.store);
                if (!confirm(`Restore ${parsed.importedCount} transaction(s) and ${parsed.importedAccounts.length} account(s) from Excel? This will replace your current data.`)) {
                    return;
                }

                this.store.accounts = parsed.importedAccounts;
                this.store.dataByMonth = parsed.importedData;
                this.store.saveAccounts();
                this.store.saveTransactions();

                if (parsed.importedBudgets !== null) {
                    this.store.budgets = parsed.importedBudgets;
                    this.store.saveBudgets();
                }
                if (parsed.importedRecurring !== null) {
                    this.store.recurringRules = parsed.importedRecurring;
                    this.store.saveRecurring();
                }

                this.cancelEdit();
                const months = Object.keys(this.store.dataByMonth).sort();
                if (months.length > 0 && !this.store.dataByMonth[this.dom.monthFilter.value]) {
                    this.dom.monthFilter.value = months[months.length - 1];
                }

                this.refreshAll();
                alert('Data restored successfully from Excel!');
            } catch (err) {
                console.error(err);
                alert(err.message || 'Failed to read the Excel file. Please make sure it is a valid .xlsx/.xls backup file.');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    // Rendering
    refreshAll() {
        this.renderAccountDropdowns();
        this.renderAccountLists();
        this.renderBudgetsManager();
        this.renderRecurringList();
        this.renderUI();
    }

    renderAccountDropdowns() {
        const assetOptions = this.store.getAccountsByType('asset')
            .map(a => `<option value="${Utils.escapeHtml(a.id)}">${Utils.escapeHtml(a.name)}</option>`)
            .join('');
        const liabilityOptions = this.store.getAccountsByType('liability')
            .map(a => `<option value="${Utils.escapeHtml(a.id)}">${Utils.escapeHtml(a.name)}</option>`)
            .join('');

        const prevAsset = this.dom.assetSelect.value;
        const prevTransfer = this.dom.transferSelect.value;
        const prevLiability = this.dom.liabilitySelect.value;
        const prevHistoryAcc = this.dom.historyAccountFilter.value;

        this.dom.assetSelect.innerHTML = assetOptions;
        this.dom.transferSelect.innerHTML = assetOptions;
        this.dom.liabilitySelect.innerHTML = liabilityOptions;
        this.dom.historyAccountFilter.innerHTML =
            `<option value="all">All accounts</option>` +
            this.store.accounts.map(a => `<option value="${Utils.escapeHtml(a.id)}">${Utils.escapeHtml(a.name)}</option>`).join('');

        this.setSelectIfValid(this.dom.assetSelect, prevAsset);
        this.setSelectIfValid(this.dom.transferSelect, prevTransfer);
        this.setSelectIfValid(this.dom.liabilitySelect, prevLiability);
        if (prevHistoryAcc === 'all' || this.store.getAccount(prevHistoryAcc)) {
            this.dom.historyAccountFilter.value = prevHistoryAcc;
        }
    }

    renderAccountLists() {
        const renderGroup = (items) => {
            if (items.length === 0) return `<li class="empty-msg">None</li>`;
            return items.map(a => `
                <li>
                    <span title="${Utils.escapeHtml(a.name)}">${Utils.escapeHtml(a.name)}</span>
                    <div class="item-actions">
                        ${a.type === 'asset' ? `<button type="button" data-action="adjust" data-id="${Utils.escapeHtml(a.id)}" class="btn-adjust-mini" title="Adjust balance">⚖</button>` : ''}
                        <button type="button" data-action="rename" data-id="${Utils.escapeHtml(a.id)}" class="btn-edit-mini" title="Rename account">✎</button>
                        <button type="button" data-action="delete" data-id="${Utils.escapeHtml(a.id)}" class="btn-del-mini" title="Delete account">✖</button>
                    </div>
                </li>
            `).join('');
        };

        this.dom.assetAccList.innerHTML = renderGroup(this.store.getAccountsByType('asset'));
        this.dom.expenseAccList.innerHTML = renderGroup(this.store.getAccountsByType('liability'));
    }

    renderBudgetsManager() {
        const currentVal = this.dom.budgetSelect.value;
        const expenseAccounts = this.store.getAccountsByType('liability');
        this.dom.budgetSelect.innerHTML =
            `<option value="${OVERALL_BUDGET_KEY}">Overall Monthly Spending</option>` +
            expenseAccounts.map(a => `<option value="${Utils.escapeHtml(a.id)}">${Utils.escapeHtml(a.name)}</option>`).join('');
        this.setSelectIfValid(this.dom.budgetSelect, currentVal);

        const entries = this.store.getActiveBudgets();
        if (entries.length === 0) {
            this.dom.budgetList.innerHTML = `<li class="empty-msg">No monthly budgets configured.</li>`;
            return;
        }

        this.dom.budgetList.innerHTML = entries.map(([key, limit]) => `
            <li>
                <span>${Utils.escapeHtml(this.store.getAccountName(key))}: <strong>${Utils.escapeHtml(Utils.formatCurrency(limit, this.privacyMode))}</strong></span>
                <button type="button" class="btn-del-mini" data-action="remove-budget" data-id="${Utils.escapeHtml(key)}" title="Remove budget">✕</button>
            </li>
        `).join('');
    }

    renderRecurringList() {
        const currentToday = Utils.getLocalDateString();
        let dueCount = 0;

        if (this.store.recurringRules.length === 0) {
            this.dom.recurringList.innerHTML = `<li class="empty-msg">No recurring transactions. Check "Recurring transaction" when adding one.</li>`;
            this.dom.recordDueBtn.innerText = 'Record Due';
            this.dom.recordDueBtn.disabled = true;
            return;
        }

        const freqLabels = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
        this.dom.recurringList.innerHTML = this.store.recurringRules.map(rule => {
            const isDue = Boolean(rule.nextDate && rule.nextDate <= currentToday);
            if (isDue) dueCount++;

            const accLabel = rule.targetId
                ? `${this.store.getAccountName(rule.accountId)} → ${this.store.getAccountName(rule.targetId)}`
                : this.store.getAccountName(rule.accountId);
            const typeColor = rule.type === 'income' ? 'blue' : (rule.type === 'expense' ? 'red' : 'orange');
            const sign = rule.type === 'income' ? '+' : (rule.type === 'expense' ? '-' : '⇄ ');
            const formattedNext = rule.nextDate
                ? `${rule.nextDate.slice(8, 10)}/${rule.nextDate.slice(5, 7)}/${rule.nextDate.slice(0, 4)}`
                : '--';

            return `
                <li>
                    <div>
                        <strong>${Utils.escapeHtml(rule.desc)}</strong>
                        <span class="${typeColor}" style="margin-left: 6px;">${Utils.escapeHtml(Utils.formatCurrency(rule.amount, this.privacyMode, sign))}</span>
                        <span class="freq-badge">${Utils.escapeHtml(freqLabels[rule.frequency] || rule.frequency)}</span>
                        ${isDue ? '<span class="due-badge">Due</span>' : ''}<br>
                        <small style="color: var(--text-muted);">${Utils.escapeHtml(accLabel)} · Next: ${Utils.escapeHtml(formattedNext)}</small>
                    </div>
                    <div class="recurring-actions">
                        <button type="button" class="btn-mini-action" data-action="record" data-id="${Utils.escapeHtml(rule.id)}" title="Record next occurrence now">Record</button>
                        <button type="button" class="btn-del-mini" data-action="delete" data-id="${Utils.escapeHtml(rule.id)}" title="Remove recurring rule">✕</button>
                    </div>
                </li>
            `;
        }).join('');

        this.dom.recordDueBtn.innerText = dueCount > 0 ? `Record Due (${dueCount})` : 'Record Due';
        this.dom.recordDueBtn.disabled = dueCount === 0;
    }

    renderHistory(selectedMonth) {
        const searchKeyword = this.dom.historySearch.value.trim().toLowerCase();
        const selectedType = this.dom.historyTypeFilter.value;
        const selectedAcc = this.dom.historyAccountFilter.value;

        const sortedItems = this.store.groupTransactionsForHistory(selectedMonth);
        const filteredItems = sortedItems.filter((item) => {
            const matchesType = selectedType === 'all' ||
                (selectedType === 'transfer'
                    ? (item.txType === 'transfer' || item.txType === 'transfer_out' || item.txType === 'transfer_in')
                    : item.txType === selectedType);
            if (!matchesType) return false;

            const matchesAcc = selectedAcc === 'all' ||
                item.accountId === selectedAcc ||
                item.targetId === selectedAcc;
            if (!matchesAcc) return false;

            if (!searchKeyword) return true;
            return item.desc.toLowerCase().includes(searchKeyword) ||
                item.tag.toLowerCase().includes(searchKeyword);
        });

        if (filteredItems.length === 0) {
            this.dom.txList.innerHTML = `<li class="empty-msg">No transactions found.</li>`;
            return;
        }

        this.dom.txList.innerHTML = filteredItems.map((item) => {
            const dateParts = (item.date || '').split('-');
            const month = dateParts[1] || '--';
            const day = dateParts[2] || '--';
            const idList = item.ids.join(',');
            const canEdit = item.txType === 'income' || item.txType === 'expense' || item.txType === 'transfer';
            const amountDisplay = Utils.formatCurrency(item.amount, this.privacyMode, item.sign);

            return `
                <li>
                    <div>
                        <small style="color: var(--text-muted);">${Utils.escapeHtml(day)}/${Utils.escapeHtml(month)}</small><br>
                        <strong>${Utils.escapeHtml(item.desc)}</strong><br>
                        <span class="account-tag">💳 ${Utils.escapeHtml(item.tag)}</span>
                    </div>
                    <div style="text-align: right;">
                        <span class="${item.colorClass}">${Utils.escapeHtml(amountDisplay)}</span>
                        <div class="history-actions">
                            ${canEdit ? `<button type="button" data-action="edit" data-month="${Utils.escapeHtml(selectedMonth)}" data-ids="${Utils.escapeHtml(idList)}" class="btn-edit-mini" title="Edit transaction">✎</button>` : ''}
                            <button type="button" data-action="delete" data-month="${Utils.escapeHtml(selectedMonth)}" data-ids="${Utils.escapeHtml(idList)}" class="btn-del-mini" title="Delete transaction">✕</button>
                        </div>
                    </div>
                </li>
            `;
        }).join('');
    }

    renderBudgetProgress(monthlySummary) {
        const activeBudgets = this.store.getActiveBudgets();
        if (activeBudgets.length === 0) {
            this.dom.budgetProgressSection.innerHTML = '';
            return;
        }

        const itemsHtml = activeBudgets.map(([key, limit]) => {
            const spent = key === OVERALL_BUDGET_KEY
                ? monthlySummary.expense
                : (monthlySummary.expenseByCategory[key] || 0);
            const pct = Math.round((spent / limit) * 100);
            const barWidth = Math.min(pct, 100);
            const barClass = pct >= 100 ? 'bar-over' : (pct >= 80 ? 'bar-warn' : 'bar-ok');
            const textClass = pct >= 100 ? 'red' : (pct >= 80 ? 'orange' : 'green');
            const statusLabel = pct >= 100 ? `${pct}% (Over budget!)` : `${pct}%`;

            return `
                <div class="budget-progress-item">
                    <div class="budget-progress-header">
                        <span>${Utils.escapeHtml(this.store.getAccountName(key))}</span>
                        <span class="${textClass}">${Utils.escapeHtml(Utils.formatCurrency(spent, this.privacyMode))} / ${Utils.escapeHtml(Utils.formatCurrency(limit, this.privacyMode))} (${statusLabel})</span>
                    </div>
                    <div class="budget-bar-bg">
                        <div class="budget-bar-fill ${barClass}" style="width: ${barWidth}%;"></div>
                    </div>
                </div>
            `;
        }).join('');

        this.dom.budgetProgressSection.innerHTML = `
            <hr style="margin: 15px 0; border: 0; border-top: 1px dashed var(--border-color);">
            <h3 class="section-subheading">MONTHLY BUDGETS:</h3>
            <div class="budget-progress-wrap">${itemsHtml}</div>
        `;
    }

    renderUI() {
        const selectedMonth = this.getSelectedMonth();
        this.renderHistory(selectedMonth);

        const totalBalances = this.store.computeAllAssetBalances();
        const monthlySummary = this.store.computeMonthlySummary(selectedMonth);

        const chartLabels = [];
        const chartData = [];
        this.store.getAccountsByType('liability').forEach(a => {
            const spent = monthlySummary.expenseByCategory[a.id] || 0;
            if (spent > 0) {
                chartLabels.push(a.name);
                chartData.push(spent);
            }
        });
        this.charts.renderExpenseDoughnut(chartLabels, chartData, this.privacyMode);
        this.charts.renderTrendBar(selectedMonth, this.store, this.privacyMode);

        const [yearPart, monthPart] = selectedMonth.split('-');
        this.dom.reportTitle.innerText = `Monthly report ${monthPart}/${yearPart}`;

        const netCashflow = monthlySummary.income - monthlySummary.expense;
        const netSign = netCashflow >= 0 ? '+' : '-';
        const netClass = netCashflow >= 0 ? 'blue' : 'red';

        let htmlContent = `
            <div class="row"><span>Monthly income:</span> <b class="blue">${Utils.escapeHtml(Utils.formatCurrency(monthlySummary.income, this.privacyMode, '+'))}</b></div>
            <div class="row"><span>Monthly spending:</span> <b class="red">${Utils.escapeHtml(Utils.formatCurrency(monthlySummary.expense, this.privacyMode, '-'))}</b></div>
            <div class="row"><span>Monthly net cashflow:</span> <b class="${netClass}">${Utils.escapeHtml(Utils.formatCurrency(Math.abs(netCashflow), this.privacyMode, netSign))}</b></div>
            <hr style="margin: 15px 0; border: 0; border-top: 1px dashed var(--border-color);">
            <h3 class="section-subheading">CURRENT ASSETS:</h3>
        `;

        let netWorth = 0;
        this.store.getAccountsByType('asset').forEach(a => {
            const balance = totalBalances[a.id] || 0;
            htmlContent += `<div class="row sub-row"><span>${Utils.escapeHtml(a.name)}</span> <span>${Utils.escapeHtml(Utils.formatCurrency(balance, this.privacyMode))}</span></div>`;
            netWorth += balance;
        });

        this.dom.reportContent.innerHTML = htmlContent;
        this.renderBudgetProgress(monthlySummary);
        this.dom.totalSum.innerText = Utils.formatCurrency(netWorth, this.privacyMode);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const app = new FinanceApp();
    app.init();
});
