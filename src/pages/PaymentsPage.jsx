import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listClaims } from '../api/payments.js';
import Dues from './payments/Dues.jsx';
import Transactions from './payments/Transactions.jsx';
import FeePlans from './payments/FeePlans.jsx';
import OnlinePayments from './payments/OnlinePayments.jsx';
import '../styles/seats.css';
import '../styles/members.css';
import '../styles/bookings.css';
import '../styles/payments.css';

const VIEWS = [
  { key: 'dues', label: 'Dues' },
  { key: 'online', label: 'Online payments' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'fees', label: 'Fee plans' },
];

export default function PaymentsPage() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some((v) => v.key === params.get('view')) ? params.get('view') : 'dues';
  const [pending, setPending] = useState(0);
  const countPending = useCallback(() => {
    listClaims('pending').then((d) => setPending(d.claims.length)).catch(() => {});
  }, []);

  useEffect(() => {
    countPending();
  }, [countPending]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Reading room</p>
          <h1>Payments</h1>
          <p className="page-sub">Collect fees, track dues and keep a clean record of every rupee.</p>
        </div>
      </header>

      <nav className="page-tabs" role="tablist" aria-label="Payments sections">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            className={`page-tab${view === v.key ? ' on' : ''}`}
            onClick={() => setParams(v.key === 'dues' ? {} : { view: v.key }, { replace: true })}
          >
            {v.label}
            {v.key === 'online' && pending > 0 && <span className="tab-badge" aria-label={`${pending} waiting`}>{pending}</span>}
          </button>
        ))}
      </nav>

      {view === 'dues' && <Dues />}
      {view === 'online' && <OnlinePayments onChange={countPending} />}
      {view === 'transactions' && <Transactions />}
      {view === 'fees' && <FeePlans />}
    </div>
  );
}
