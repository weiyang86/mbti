import { AdminShell } from "../../components/admin-shell";
import { AdminPayments } from "../../components/admin-payments";

export default function PaymentsPage() {
  return <AdminShell permission="admin.payment.read"><AdminPayments /></AdminShell>;
}
