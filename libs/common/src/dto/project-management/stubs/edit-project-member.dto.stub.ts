import { memberProjectEntityStub } from "@app/common/database/test/support/stubs"
import { EditProjectMemberDto } from "../dto/project-member.dto"

export const editProjectMemberDtoStub = (): EditProjectMemberDto => {
  const eStub = memberProjectEntityStub()

  return {
    projectId: eStub.project.id,
    memberId: eStub.member.id,
    role: eStub.role
  }
}