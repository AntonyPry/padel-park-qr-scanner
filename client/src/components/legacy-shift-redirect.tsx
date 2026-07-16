import { Navigate, useLocation } from 'react-router-dom';

export function LegacyShiftRedirect({ to }: { to: string }) {
  const { hash, search } = useLocation();

  return <Navigate replace to={{ hash, pathname: to, search }} />;
}
