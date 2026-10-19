let prepare: (() => Promise<boolean>) | null = null;

export function registerStorageTransition(action: () => Promise<boolean>) {
    prepare = action;
    return () => {
        if (prepare === action) prepare = null;
    };
}

export const prepareStorageTransition = () => prepare ? prepare() : Promise.resolve(false);
