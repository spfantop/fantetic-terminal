/**
 * 将不可信参数编码为一个 POSIX shell 字面量，避免 ssh exec 的远端 shell 解释内容。
 */
export const quotePosixShellArgument = (value: string): string => {
    return `'${value.replace(/'/g, `'\\''`)}'`;
};
