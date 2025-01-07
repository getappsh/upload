import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common"
import { TokenVerificationGuard } from "../guards/token-verification.guard"

export const TokenVerification = (...roles: string[]) => {
  return applyDecorators(
    SetMetadata('roles', roles),
    UseGuards(TokenVerificationGuard)
  ) 
}