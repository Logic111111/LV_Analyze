// Who may do what with a design (P7.4). Pure functions of the design row, the user and their
// membership (role) in the organisation the design is shared with, so they're tested on their own
// and every route asks the same questions.
//
//   read     owner, or any member of the design's organisation
//   edit     owner, or a designer / admin of its organisation; never while it is submitted for
//            review (the reviewed content must not change underneath the reviewer)
//   delete   owner, or an admin of its organisation
//   share    owner only (to an organisation they belong to)
//   submit   anyone who may edit, once the design is shared with an organisation, from draft or
//            rejected
//   reject   a reviewer, approver or admin of its organisation, while submitted
//   approve  an approver or admin of its organisation, while submitted, and not the person who
//            submitted it (four-eyes principle)
// An edit to an approved design keeps the approved version locked and starts a new draft.
const ROLES = ['designer', 'reviewer', 'approver', 'admin'];
const STATUSES = ['draft', 'submitted', 'approved', 'rejected'];

const isOwner = (design, userId) => Number(design.userId) === Number(userId);
const roleOf = (membership) => (membership ? membership.role : null);

function can(action, { design, userId, membership, lastSubmitterId = null }) {
  const role = roleOf(membership);
  const inOrg = !!design.orgId && !!role;
  switch (action) {
    case 'read': return isOwner(design, userId) || inOrg;
    case 'edit': return design.status !== 'submitted' && (isOwner(design, userId) || (inOrg && ['designer', 'admin'].includes(role)));
    case 'delete': return isOwner(design, userId) || (inOrg && role === 'admin');
    case 'share': return isOwner(design, userId);
    case 'submit': return !!design.orgId && ['draft', 'rejected'].includes(design.status) && (isOwner(design, userId) || (inOrg && ['designer', 'admin'].includes(role)));
    case 'reject': return design.status === 'submitted' && inOrg && ['reviewer', 'approver', 'admin'].includes(role);
    case 'approve': return design.status === 'submitted' && inOrg && ['approver', 'admin'].includes(role) && Number(lastSubmitterId) !== Number(userId);
    default: return false;
  }
}

module.exports = { can, ROLES, STATUSES };
