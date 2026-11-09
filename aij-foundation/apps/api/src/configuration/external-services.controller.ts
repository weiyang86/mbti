import { Body, Controller, Get, Header, Param, Put, Req } from '@nestjs/common';
import type { AdminRequest } from '../auth/auth.types';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ExternalServicesBodyPipe, SaveExternalServiceDto } from './external-services.dto';
import { ExternalServicesService } from './external-services.service';
@Controller('admin/external-services')
@Permissions('admin.config.manage')
export class ExternalServicesController {
    constructor(private readonly services: ExternalServicesService) { }
    @Get('catalog')
    @Header('Cache-Control', 'no-store')
    catalog(
    @Req()
    r: AdminRequest) { return this.services.catalog(r.user!.id); }
    @Get()
    @Header('Cache-Control', 'no-store')
    list(
    @Req()
    r: AdminRequest) { return this.services.list(r.user!.id); }
    @Get(':providerCode')
    @Header('Cache-Control', 'no-store')
    get(
    @Param('providerCode')
    code: string,
    @Req()
    r: AdminRequest) { return this.services.get(code, r.user!.id); }
    @Put(':providerCode')
    @Header('Cache-Control', 'no-store')
    save(
    @Param('providerCode')
    code: string,
    @Body(new ExternalServicesBodyPipe())
    dto: object,
    @Req()
    r: AdminRequest) { return this.services.save(code, dto as SaveExternalServiceDto, r.user!.id, r.correlationId); }
}
