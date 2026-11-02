/** 注册 `/memory`；返回精确的注销 disposer。 */
export function registerMemoryCommand(ctx, controller) {
    return ctx.commands.register({
        name: 'memory',
        description: '项目记忆：list / open <id> / forget <id> / end',
        input: { hint: '<list|open <id>|forget <id>|end>' },
        handler: (invocation) => controller.command(invocation.rawInput, invocation.agent),
    });
}
