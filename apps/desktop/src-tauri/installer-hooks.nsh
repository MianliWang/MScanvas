; The uninstaller's hook for the view cache (OWNER_DECISIONS_V511 DEF-2, option
; (b); ADR 0060). An uninstall that is not an update removes the view cache
; folder and nothing else. Presets and preferences stay behind the template's
; "Delete the application data" box.
;
; It is no looser than src/view_cache.rs, whose tests pin the names below: the
; root must be one Rust would open, with Rust's marker byte for byte, and a tree
; with a link or other reparse point anywhere in it is left whole.
;
; RMDir /r is never used here. NSIS 3.11's follows a junction, as the root or
; inside the tree, and deletes what its target holds (run 2026-11-03).
;
; It never fails an uninstall and never prompts: what cannot be removed stays.
; The marker goes last, so a root that a locked file keeps is still a root to
; Rust and to the next uninstall.
;
; ponytail: the first walk and the second are separate steps and each name is
; checked just before it is removed, so a same-user writer racing the check is
; the residual, as in view_cache.rs. A handle-based delete would need a plugin.

!include "LogicLib.nsh"

!define MSCANVAS_VIEW_CACHE_ROOT "view-cache"
!define MSCANVAS_VIEW_CACHE_MARKER ".mscanvas-view-cache-owner"
!define MSCANVAS_VIEW_CACHE_MARKER_CONTENT "mscanvas-view-cache$\n"
!define MSCANVAS_VIEW_CACHE_ENTRIES "entries"
!define MSCANVAS_VIEW_CACHE_STAGING "staging"

!define MSCANVAS_ATTRIBUTE_DIRECTORY 0x10
; GetFileAttributesW answers -1 when it cannot say. That has this bit set too, so
; one test refuses both a reparse point and a name that cannot be described.
!define MSCANVAS_ATTRIBUTE_REPARSE_POINT 0x400

Var MscanvasViewCacheMarker
Var MscanvasViewCacheRemoving
Var MscanvasViewCacheLeft

; What is at $R0\$R1, into $R2: "none", or "directory" or "file" when it is plain
; and spelled on disk exactly so, as Rust requires, or else "other".
Function un.MscanvasViewCacheKind
  StrCpy $R2 "none"
  FindFirst $R3 $R4 "$R0\$R1"
  ${If} $R4 != ""
    FindClose $R3
    StrCpy $R2 "other"
    StrCpy $R5 "$R0\$R1"
    System::Call 'kernel32::GetFileAttributesW(w R5) i .R6'
    IntOp $R7 $R6 & ${MSCANVAS_ATTRIBUTE_REPARSE_POINT}
    ${If} $R4 S== $R1
    ${AndIf} $R7 = 0
      IntOp $R7 $R6 & ${MSCANVAS_ATTRIBUTE_DIRECTORY}
      ${If} $R7 <> 0
        StrCpy $R2 "directory"
      ${Else}
        StrCpy $R2 "file"
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

; Walks below the folder on the stack, passing over the marker and never entering
; a reparse point. Removes as it goes only while Removing is 1. Left becomes 1 at
; a reparse point, a name it cannot describe, or anything that would not go.
Function un.MscanvasViewCacheWalk
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  FindFirst $1 $2 "$0\*"
  ${DoWhile} $2 != ""
    StrCpy $3 "$0\$2"
    ${If} $2 != "."
    ${AndIf} $2 != ".."
    ${AndIf} $3 != $MscanvasViewCacheMarker
      System::Call 'kernel32::GetFileAttributesW(w r3) i .r4'
      IntOp $5 $4 & ${MSCANVAS_ATTRIBUTE_REPARSE_POINT}
      ${If} $5 <> 0
        StrCpy $MscanvasViewCacheLeft 1
      ${Else}
        IntOp $5 $4 & ${MSCANVAS_ATTRIBUTE_DIRECTORY}
        ${If} $5 <> 0
          Push $3
          Call un.MscanvasViewCacheWalk
        ${EndIf}
        ${If} $MscanvasViewCacheRemoving = 1
          ClearErrors
          ${If} $5 <> 0
            RMDir $3
          ${Else}
            Delete $3
          ${EndIf}
          ${IfThen} ${Errors} ${|} StrCpy $MscanvasViewCacheLeft 1 ${|}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    FindNext $1 $2
  ${Loop}
  FindClose $1
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Takes the application-local folder from the stack, and removes its view cache
; if Rust would recognize it. Any doubt removes nothing and says nothing.
Function un.MscanvasRemoveViewCache
  Pop $0
  System::Call 'kernel32::GetFileAttributesW(w r0) i .r2'
  IntOp $2 $2 & ${MSCANVAS_ATTRIBUTE_REPARSE_POINT}
  ${If} $2 <> 0
    Return
  ${EndIf}

  StrCpy $R0 $0
  StrCpy $R1 "${MSCANVAS_VIEW_CACHE_ROOT}"
  Call un.MscanvasViewCacheKind
  ${If} $R2 != "directory"
    Return
  ${EndIf}

  StrCpy $1 "$0\${MSCANVAS_VIEW_CACHE_ROOT}"
  StrCpy $R0 $1
  StrCpy $R1 "${MSCANVAS_VIEW_CACHE_ENTRIES}"
  Call un.MscanvasViewCacheKind
  ${If} $R2 != "none"
  ${AndIf} $R2 != "directory"
    Return
  ${EndIf}
  StrCpy $R1 "${MSCANVAS_VIEW_CACHE_STAGING}"
  Call un.MscanvasViewCacheKind
  ${If} $R2 != "none"
  ${AndIf} $R2 != "directory"
    Return
  ${EndIf}

  StrCpy $R1 "${MSCANVAS_VIEW_CACHE_MARKER}"
  Call un.MscanvasViewCacheKind
  ${If} $R2 != "file"
    Return
  ${EndIf}
  StrCpy $MscanvasViewCacheMarker "$1\${MSCANVAS_VIEW_CACHE_MARKER}"
  ClearErrors
  FileOpen $2 $MscanvasViewCacheMarker r
  ${If} ${Errors}
    ClearErrors
    Return
  ${EndIf}
  FileRead $2 $3 64
  ; The end of the file sets the error flag: nothing may follow the one line.
  ClearErrors
  FileRead $2 $4 1
  ${IfNot} ${Errors}
    StrCpy $3 ""
  ${EndIf}
  FileClose $2
  ClearErrors
  ${If} $3 S!= "${MSCANVAS_VIEW_CACHE_MARKER_CONTENT}"
    Return
  ${EndIf}

  StrCpy $MscanvasViewCacheLeft 0
  StrCpy $MscanvasViewCacheRemoving 0
  Push $1
  Call un.MscanvasViewCacheWalk
  ${If} $MscanvasViewCacheLeft <> 0
    Return
  ${EndIf}

  StrCpy $MscanvasViewCacheRemoving 1
  Push $1
  Call un.MscanvasViewCacheWalk
  ${If} $MscanvasViewCacheLeft = 0
    Delete $MscanvasViewCacheMarker
    RMDir $1
  ${EndIf}
  ClearErrors
FunctionEnd

; After the template's Section Uninstall has closed the application and, with the
; box ticked, removed the whole parent: the hook then finds nothing to do. Before
; that (NSIS_HOOK_PREUNINSTALL) the application may still hold the cache open.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    Push "$LOCALAPPDATA\${BUNDLEID}"
    Call un.MscanvasRemoveViewCache
  ${EndIf}
!macroend
