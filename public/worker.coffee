importScripts '/lib/cmm/index.min.js'

###
iterator = null

cmm.events.onstdout((output) -> setOutput output)

setAst = (s) -> postMessage({ type: "ast", value: s })
setOutput = (s) -> postMessage({ type: "output", value: s })
setErrorMsg = (s) -> postMessage({ type: "errormsg", value: s })
setDone = -> postMessage({ type: "done" })

isCIN = (value) -> value?.getType?() is 'CIN' and cmm.hooks.isInputBufferEmpty()

makeCompilation = (code) ->
    try
        ast = cmm.compile code
    catch error
        setErrorMsg "#{error.stack ? error.message ? error}"
        return

    setAst ast.toString()

    ast

runProgram = (ast, input, begin = no) ->
    try
        iterator = cmm.execute(ast, input) if begin
        loop
            it = iterator.next()
            if it.done
                setDone()
                return
            if isCIN it.value.value
                return

    catch error
        console.log(error.stack ? error.message ? error)
        setErrorMsg "#{error.stack ? error.message? error}"
###

###
    listen.output = ({ string }) ->
    listen.compilationError = ({ message, description }) ->
    listen.startRunning = ->
    listen.startDebugging = ->
    listen.compilationSuccessful = ({ program, ast }) ->
    listen.executionFinish = ({ status }) ->
###

memory = new cmm.Memory
debug = new cmm.Debugger
vm = null
iterator = null
debugging = no
flagPause = no

output = (string) -> postMessage({ event: "output", data: { string } })

actions = {}

actions.input = ({ input }) ->
    if debugging
        wasWaiting = vm.isWaitingForInput()

        vm.input(input)

        console.log "Input end"

        if vm.isWaitingForInput()
            evaluateDebugStatus(vm)
        else if wasWaiting and iterator?
            console.log "Continuing iterator"
            continueIterator()
        else console.log "Not continuing iterator"
    else
        resume(input)


actions.compile = ({ code }) ->
    try
        { program, ast } = cmm.compile code
    catch error
        message = error.getMessage code
        description = error.description
        postMessage({ event: "compilationError", data: { message, description } })
        return

    postMessage({ event: "compilationSuccessful", data: { instructions: program.instructionsToString(), ast: ast.toString() } })

    return program


resume = (input) ->
    throw "Not started" unless iterator?

    if vm?
        vm.input(input) if input?
        inputted = yes

    unless vm?.isWaitingForInput()
        postMessage({ event: "resumeRunning" })

        { value: vm } = iterator.next()

        vm.input(input) if input? and not inputted

        until vm.finished or vm.isWaitingForInput()
            { value: vm } = iterator.next()

        if vm.finished
            iterator.next()
            postMessage({ event: "executionFinish", data: { status: vm.status } })
            iterator = vm = null
        else
            postMessage({ event: "waitingForInput" })
    else
        postMessage({ event: "waitingForInput" })



actions.run = ({ code, input }) ->
    program = actions.compile({ code })

    if program?
        postMessage({ event: "startRunning" })

        debugging = no

        program.attachMemory memory
        program.attachOutputListener output

        iterator = cmm.run program

        resume(input)

representation = (value, type) ->
    if type.id is 'CHAR'
        "'" + value.toString() + "'"
    else if type.id is 'STRING'
        '"' + value.toString() + '"'
    else
        value

evaluateDebugStatus = (vm) ->
    if vm.isWaitingForInput()
        console.log "Waiting for input"
        postMessage({ event: "waitingForInput" })
    else if vm.finished
        console.log "Finished"
        postMessage({ event: "executionFinish", data: { status: vm.status } })
        iterator = vm = null
    else
        console.log "Paused"
        variables = {}
        for varId, variable of vm.instruction.visibleVariables
            type = variable.type

            isChar = type.id is 'CHAR'

            isArray = type.isArray

            if isArray
                value = type.castings.COUT(variable.memoryReference.getAddress())
            else
                value = type.castings.COUT(variable.memoryReference.read(memory))

            variables[varId] = { type: type.getSymbol(), value, const: variable.specifiers.const, isArray, repr: representation(value, type), isChar  }

        postMessage({ event: "paused", data: { variables: variables } })

    if vm? and vm.instruction.locations? # not finished
        postMessage({ event: "currentLine" , data: { line: vm.instruction.locations.lines.first } })


continueIterator = ->
    postMessage({ event: "resumeRunning" })

    vmCopy = vm
    { value: vm, done } = iterator.next()

    until done or vm.isWaitingForInput()
        vmCopy = vm
        { value: vm, done } = iterator.next()

    if done
        iterator = null
        vm = vmCopy

    evaluateDebugStatus(vm)

actions.debug = ({ code, input }) ->
    program = actions.compile({ code })

    console.log "Debug called"

    if program?
        postMessage({ event: "startDebugging" })

        debugging = yes

        program.attachMemory memory
        program.attachOutputListener output

        iterator = debug.debug program

        { value: vm } = iterator.next()

        console.log "Debug: start"

        vm.input(input) if input?

        { value: vm } = iterator.next()

        console.log "Debug: stop"

        evaluateDebugStatus(vm)


debugAction = (name) ->
    console.log "Debug action #{name}"
    unless vm.isWaitingForInput()
        postMessage({ event: "resumeRunning" })

        iterator = debug[name]()

        console.log "Debug action start"

        { value: vm } = iterator.next()

        console.log "Debug action end"

        evaluateDebugStatus(vm)
    else
        console.log "Not running debug action, waiting for input"

actions.stepOver = -> debugAction('stepOver')

actions.stepInto = -> debugAction('stepInto')

actions.stepOut = -> debugAction('stepOut')

actions.stepInstruction = -> debugAction('stepInstruction')

actions.endOfInput = ->
    if vm?
        vm.endOfInput()
        resume()

actions.continue = -> debugAction('continue')

actions.addBreakpoint = ({ breakpoint }) -> debug.addBreakpoints(breakpoint)
actions.removeBreakpoint = ({ breakpoint }) -> debug.removeBreakpoints(breakpoint)

actions.setVariable = ({ id, value }) ->
    variable = vm.instruction.visibleVariables[id]

    try
        value = variable.type.parse(value)
    catch error
        console.log error.stack
        cannotParse = yes

    if cannotParse
        postMessage({ event: "invalidVariableValue", data: { id, value } })
    else
        reference = variable.memoryReference
        reference.write(memory, value)

        value = variable.type.castings.COUT(value)

        postMessage({ event: "variableSet", data: { id, value, repr: representation(value, variable.type) } })



onmessage = (e) ->
    { data } = e

    { command } = data

    unless actions[command]?
        throw "invalid command #{command}"
    else
        actions[command](data)

    ###
    switch command
        when "compile"
            makeCompilation(code, yes)
        when "input"
            cmm.hooks.setInput input
            if iterator?
                runProgram()
        when "run"
            ast = makeCompilation(code)
            if ast?
                runProgram(ast, input, yes)
        when "debug"
            console.log "debug"
        when "stop"
        when "pause"
        when "stepOver"
        when "stepInto"
        when "stepOut"
        when "endOfInput"
            cmm.hooks.endOfInput()

    ###
