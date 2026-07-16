import { Navigate } from 'react-router-dom';

export function LegacyShiftRedirect({ to }: { to: string }) {
  return <Navigate replace to={to} />;
}
