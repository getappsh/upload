import { memberProjectEntityStub } from "@app/common/database/test/support/stubs"
import { AddMemberToProjectDto } from "../dto/project-member.dto"

export const addMemberToProjectDtoStub = (): AddMemberToProjectDto => {
  const eStub = memberProjectEntityStub()

  return {
    projectId: eStub.project.id,
    email: eStub.member.email,
    role: eStub.role
  }
}
