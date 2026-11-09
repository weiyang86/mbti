/** W15 draft schema only. Sources and deliberately limited coverage: AF-193-ROOT_WIRING.md. */
import { BadRequestException } from "@nestjs/common";
export type ExternalField = {
    key: string;
    label: string;
    kind: 'text' | 'url' | 'number' | 'select';
    required: boolean;
    maxLength: number;
    options?: {
        value: string;
        label: string;
    }[];
};
export type ExternalProvider = {
    code: string;
    label: string;
    category: 'model' | 'storage' | 'payment' | 'notification';
    fields: ExternalField[];
    credentials: {
        key: string;
        label: string;
        required: boolean;
    }[];
};
const text = (key: string, label: string, maxLength = 128): ExternalField => ({ key, label, kind: 'text', required: true, maxLength });
const url = (key: string, label: string): ExternalField => ({ ...text(key, label, 512), kind: 'url' });
const credential = (key: string, label: string) => ({ key, label, required: true });
const app = [text('appId', 'App ID')];
const definitions: ExternalProvider[] = [
    { code: 'deepseek', label: 'DeepSeek', category: 'model', fields: [url('baseUrl', 'API Base URL'), text('model', '模型')], credentials: [credential('apiKey', 'API Key 引用')] },
    { code: 'aliyun', label: '阿里云百炼', category: 'model', fields: [url('baseUrl', 'OpenAI 兼容 Base URL'), text('model', '模型')], credentials: [credential('apiKey', 'API Key 引用')] },
    { code: 'qiniu', label: '七牛云', category: 'storage', fields: [text('bucket', '空间名称'), text('region', '区域'), url('downloadOrigin', '下载域名 HTTPS Origin')], credentials: [credential('accessKey', 'AccessKey 引用'), credential('secretKey', 'SecretKey 引用')] },
    { code: 'wechat-pay', label: '微信支付', category: 'payment', fields: [...app, text('merchantId', '商户号'), url('notifyUrl', '通知 URL')], credentials: [credential('apiV3Key', 'APIv3 Key 引用'), credential('privateKey', '商户私钥引用')] },
    { code: 'alipay', label: '支付宝', category: 'payment', fields: [...app, url('notifyUrl', '通知 URL')], credentials: [credential('privateKey', '应用私钥引用'), credential('alipayPublicKey', '支付宝公钥引用')] },
    { code: 'douyin-pay', label: '抖音支付', category: 'payment', fields: [...app], credentials: [credential('salt', '支付 SALT 引用')] },
    { code: 'email', label: '邮件 SMTP', category: 'notification', fields: [text('host', 'SMTP 主机'), { ...text('port', 'SMTP 端口', 5), kind: 'number' }, text('from', '发件邮箱', 254)], credentials: [credential('username', 'SMTP 用户名引用'), credential('password', 'SMTP 密码引用')] },
    { code: 'sms', label: '阿里云短信', category: 'notification', fields: [text('signName', '签名'), text('templateCode', '模板编码')], credentials: [credential('accessKeyId', 'AccessKey ID 引用'), credential('accessKeySecret', 'AccessKey Secret 引用')] },
    { code: 'wechat-official', label: '微信公众号', category: 'notification', fields: [...app], credentials: [credential('appSecret', 'AppSecret 引用')] },
    { code: 'wechat-miniapp', label: '微信小程序', category: 'notification', fields: [...app], credentials: [credential('appSecret', 'AppSecret 引用')] },
    { code: 'wecom', label: '企业微信', category: 'notification', fields: [text('corpId', '企业 ID'), text('agentId', '应用 ID')], credentials: [credential('corpSecret', '应用 Secret 引用')] },
    { code: 'dingtalk', label: '钉钉', category: 'notification', fields: [text('appKey', 'AppKey')], credentials: [credential('appSecret', 'AppSecret 引用')] },
    { code: 'feishu', label: '飞书', category: 'notification', fields: [...app], credentials: [credential('appSecret', 'App Secret 引用')] },
    // Webhook URLs often contain bearer tokens: the entire destination is a secret reference.
    { code: 'webhook', label: 'Webhook', category: 'notification', fields: [], credentials: [credential('webhookUrl', 'HTTPS Webhook URL 引用')] }
];
function freeze<T>(v: T): T { if (v && typeof v === 'object') {
    for (const child of Object.values(v))
        freeze(child);
    Object.freeze(v);
} return v; }
export const EXTERNAL_SERVICE_CATALOG = freeze({ schemaVersion: 1 as const, providers: definitions });
export function externalProvider(code: string): ExternalProvider {
    const result = definitions.find(p => p.code === code);
    if (!result)
        throw new BadRequestException('Invalid external service provider');
    return result;
}
