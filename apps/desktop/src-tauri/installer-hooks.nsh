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
; The marker goes last, and comes back if the root then will not go, so a root
; that anything keeps is still a root to Rust and to the next uninstall.
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
Var MscanvasViewCacheCompared

; ${If} $a MscanvasSame $b, by code unit. NSIS's own string tests go by collation,
; which ignores characters such as U+00AD and U+200D altogether, and Rust does not.
!macro _MscanvasSame _a _b _t _f
  Push `${_b}`
  Push `${_a}`
  System::Call 'kernel32::CompareStringOrdinal(w s, i -1, w s, i -1, i 0) i .s'
  Pop $MscanvasViewCacheCompared
  IntCmp $MscanvasViewCacheCompared 2 `${_t}` `${_f}` `${_f}`
!macroend

; What is at $R0\$R1, into $R2: "none", or "directory" or "file" when it is plain
; and spelled on disk exactly so, as Rust requires, or else "other".
Function un.MscanvasViewCacheKind
  StrCpy $R2 "none"
  ClearErrors
  FindFirst $R3 $R4 "$R0\$R1"
  ${IfNot} ${Errors}
    FindClose $R3
    StrCpy $R2 "other"
    StrCpy $R5 "$R0\$R1"
    System::Call 'kernel32::GetFileAttributesW(w R5) i .R6'
    IntOp $R7 $R6 & ${MSCANVAS_ATTRIBUTE_REPARSE_POINT}
    ${If} $R4 MscanvasSame $R1
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
; a reparse point, a name it cannot describe, a folder it cannot list, or anything
; that would not go.
Function un.MscanvasViewCacheWalk
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  ClearErrors
  FindFirst $1 $2 "$0\*"
  ${If} ${Errors}
    StrCpy $MscanvasViewCacheLeft 1
  ${Else}
    ${Do}
      StrCpy $3 "$0\$2"
      ${IfNot} $2 MscanvasSame "."
      ${AndIfNot} $2 MscanvasSame ".."
      ${AndIfNot} $3 MscanvasSame $MscanvasViewCacheMarker
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
      ClearErrors
      FindNext $1 $2
      ${If} ${Errors}
        ${ExitDo}
      ${EndIf}
    ${Loop}
    FindClose $1
  ${EndIf}
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
  ${IfNot} $R2 MscanvasSame "directory"
    Return
  ${EndIf}

  StrCpy $1 "$0\${MSCANVAS_VIEW_CACHE_ROOT}"
  StrCpy $R0 $1
  StrCpy $R1 "${MSCANVAS_VIEW_CACHE_ENTRIES}"
  Call un.MscanvasViewCacheKind
  ${IfNot} $R2 MscanvasSame "none"
  ${AndIfNot} $R2 MscanvasSame "directory"
    Return
  ${EndIf}
  StrCpy $R1 "${MSCANVAS_VIEW_CACHE_STAGING}"
  Call un.MscanvasViewCacheKind
  ${IfNot} $R2 MscanvasSame "none"
  ${AndIfNot} $R2 MscanvasSame "directory"
    Return
  ${EndIf}

  StrCpy $R1 "${MSCANVAS_VIEW_CACHE_MARKER}"
  Call un.MscanvasViewCacheKind
  ${IfNot} $R2 MscanvasSame "file"
    Return
  ${EndIf}
  StrCpy $MscanvasViewCacheMarker "$1\${MSCANVAS_VIEW_CACHE_MARKER}"
  ClearErrors
  FileOpen $2 $MscanvasViewCacheMarker r
  ${If} ${Errors}
    ClearErrors
    Return
  ${EndIf}
  ; FileRead decodes by the ANSI code page. Every one of those keeps ASCII as it
  ; is and decodes no other byte to ASCII, so as many bytes as the marker has
  ; characters, and the same characters, is the same bytes.
  FileSeek $2 0 END $4
  FileSeek $2 0 SET
  FileRead $2 $3 64
  FileClose $2
  ClearErrors
  StrLen $5 "${MSCANVAS_VIEW_CACHE_MARKER_CONTENT}"
  ${If} $4 <> $5
  ${OrIfNot} $3 MscanvasSame "${MSCANVAS_VIEW_CACHE_MARKER_CONTENT}"
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
    ClearErrors
    RMDir $1
    ; Something holds the root itself, such as a terminal open in it. Without its
    ; marker Rust would call the folder not its own and no later uninstall would
    ; take it.
    ${If} ${Errors}
    ${AndIfNot} ${FileExists} $MscanvasViewCacheMarker
      FileOpen $2 $MscanvasViewCacheMarker w
      FileWrite $2 "${MSCANVAS_VIEW_CACHE_MARKER_CONTENT}"
      FileClose $2
    ${EndIf}
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
