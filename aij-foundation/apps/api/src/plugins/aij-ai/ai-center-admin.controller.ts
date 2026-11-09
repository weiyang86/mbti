import { Body, Controller, Get, Header, Put, Req } from '@nestjs/common';
import type { AdminRequest } from '../../auth/auth.types';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CONFIGURATION_PERMISSION } from '../../../../../scripts/configuration-policy.cjs';
import { SECRET_PERMISSION } from '../../../../../scripts/secret-policy.cjs';
import { AiCenterConfigurationService } from './ai-center-configuration.service';
@Controller('admin/ai/center')
@Permissions(CONFIGURATION_PERMISSION)
export class AiCenterAdminController {
    constructor(private readonly configuration: AiCenterConfigurationService) { }
    @Get('configuration')
    @Header('Cache-Control', 'no-store')
    read(
    @Req()
    r: AdminRequest) { return this.configuration.read(r.user!.id); }
    @Put('configuration')
    @Permissions(CONFIGURATION_PERMISSION, SECRET_PERMISSION)
    @Header('Cache-Control', 'no-store')
    save(
    @Body()
    body: unknown, 
    @Req()
    r: AdminRequest) { return this.configuration.save(body, r.user!.id, r.correlationId); }
}
