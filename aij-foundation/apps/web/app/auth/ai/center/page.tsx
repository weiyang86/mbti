import { AdminShell } from "../../../components/admin-shell";
import { AdminAiCenter } from "../../../components/admin-ai-center";
import { AI_CENTER_CONFIGURATION_PERMISSION } from "../../../components/admin-ai-policy";
export default function AiCenterPage(){return <AdminShell permission={AI_CENTER_CONFIGURATION_PERMISSION}><AdminAiCenter/></AdminShell>;}
