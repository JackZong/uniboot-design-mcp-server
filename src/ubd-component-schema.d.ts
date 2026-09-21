declare module '@ubd/component-schema' {
  export function builtinRegistry(): {
    validatePack(pack: unknown): {
      ok: boolean
      errors: string[]
      warnings: string[]
      coverage?: unknown
    }
    withPack(pack: unknown): ReturnType<typeof builtinRegistry>
    targets(): string[]
  }

  export const UIKitPackSchema: {
    safeParse(pack: unknown): {
      success: boolean
      data: { id: string }
      error: { issues: Array<{ path: Array<string | number>; message: string }> }
    }
  }
}
