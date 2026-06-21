## 1. Fix the `familyId` bug in frontend
In `index.html`, replace the caching logic so `init.familyId` always overrides the frontend cache, guaranteeing that users who are added to a family see the correct family's children and members.

## 2. Add Role Management UI
- Users can be 'admin' or 'member'.
- In `index.html` Settings -> 家族連携メンバー:
  - Display the role selector dropdown if the current user is an 'admin'.
  - Hide the "追加" (Add member) button and "解除" (Remove member) buttons if the current user is NOT an 'admin'. (Though users might be able to remove themselves).
- Add a new backend function `updateFamilyMemberRole_` in `Code.js` to handle role changes.

## 3. Backend logic modifications
- In `Code.js`, implement `updateFamilyMemberRole_(params)` which takes `email` and `role`.
- Register `updateFamilyMemberRole` in `handleAction`.
