import '/client/app.ng.coffee'

EXAMPLES = [
    {
        name: "Default"
        code: """
            #include <iostream>
            using namespace std;

            int main() {

            }
        """
    }

    {
        name: "MatrixMul"
        code: """
            #include <iostream>
            using namespace std;

            double** read_matrix(int* n, int* m) {
                double **M;

                cout << "Enter the first dimension: ";

                bool correct = cin >> *n;

                while (not correct) { cout << "Invalid first dimension" << endl; correct = cin >> *n; }

                cout << endl;

                cout << "Enter the second dimension: ";

                correct = cin >> *m;

                while (not correct) { cout << "Invalid second dimension" << endl; correct = cin >> *m; }

                cout << endl;

                M = new double* [*n];
                for (int i = 0; i < *n; ++i) M[i] = new double[*m];

                cout << "Reserved " << (*n)*(*m) << " elements" << endl;

                cout << "Enter the matrix:" << endl;
                for (int i = 0; i < *n; ++i)
                    for (int j = 0; j < *m; ++j)
                        cin >> M[i][j];

                return M;
            }

            void write_matrix(double **M, int n, int m) {
                for (int i = 0; i < n; ++i) {
                    for (int j = 0; j < m; ++j) {
                        cout << M[i][j] << ' ';
                    }
                    cout << endl;
                }
            }

            double** matrix_mul(double **M1, int n1, int m1, double **M2, int n2, int m2) {
                if (m1 != n2) {
                    cout << "Cannot multiply matrices with sizes " << n1 << "x" << m1 << " and " << n2 << "x" << m2 << endl;
                    return nullptr;
                }
                else {
                    double** R = new double*[n1];

                    for (int i = 0; i < n1; ++i) R[i] = new double[m2];

                    for (int i = 0; i < n1; ++i)
                        for (int j = 0; j < m2; ++j)
                            for (int k = 0; k < n2; ++k)
                                R[i][j] += M1[i][k]*M2[k][j];

                    return R;
                }
            }

            void free_matrix(double **M, int n) {
                for (int i = 0; i < n; ++i) delete[] M[i];
                delete[] M;
            }

            int main() {
                int n1, m1, n2, m2;
                double **M1, **M2;

                cout << "First matrix:" << endl;
                M1 = read_matrix(&n1, &m1);

                cout << "Second matrix:" << endl;
                M2 = read_matrix(&n2, &m2);

                double **R = matrix_mul(M1, n1, m1, M2, n2, m2);

                if (R != nullptr) {
                    write_matrix(R, n1, m2);
                    free_matrix(R, n1);
                }

                free_matrix(M1, n1);
                free_matrix(M2, n2);
            }
        """

        input: """
            10 10

            0.985972 0.41644 0.00917712 0.960001 0.738504 0.178032 0.279277 0.871901 0.937947 0.368076
            0.796421 0.501716 0.352193 0.914611 0.305051 0.170487 0.426052 0.388529 0.821443 0.341463
            0.866829 0.0475431 0.0520645 0.225011 0.521641 0.962696 0.27995 0.955066 0.789707 0.732368
            0.316189 0.877086 0.972151 0.753573 0.687137 0.96446 0.337021 0.68242 0.217289 0.813299
            0.949761 0.314933 0.604641 0.42739 0.543298 0.947111 0.0547473 0.432424 0.499621 0.630333
            0.230609 0.486681 0.739983 0.352329 0.974505 0.524403 0.107063 0.0682698 0.363578 0.149505
            0.0419426 0.994638 0.89545 0.65836 0.390982 0.462052 0.740027 0.974471 0.234875 0.374738
            0.820769 0.119097 0.884086 0.648969 0.303171 0.797565 0.223649 0.576949 0.751251 0.130427
            0.618224 0.113461 0.25556 0.614178 0.901178 0.0406404 0.732617 0.808629 0.0322353 0.515182
            0.435284 0.125175 0.393207 0.580732 0.663967 0.636366 0.402737 0.59888 0.797121 0.979881

            10 10
            -0.02	0.16	-0.46	-1.19	2.11	-0.26	0.52	-0.41	0.31	-0.34
            0.16	0.46	0.07	-0.42	1.01	0.29	0.88	-1.16	-0.53	-0.52
            0.61	-1.81	-2.38	-2.34	2.99	-0.38	1.85	0.29	-0.22	1.62
            -0.09	1.24	0.82	3.33	-3.39	-0.29	-2.40	1.12	0.40	-0.99
            0.28	-0.39	0.16	0.03	-0.38	0.95	-0.31	-0.18	0.33	-0.05
            -1.51	2.00	2.91	3.21	-3.75	0.63	-2.33	0.73	0.23	-1.98
            -2.35	2.79	2.24	0.80	-2.43	0.75	-0.80	-0.01	0.93	-1.17
            1.51	-2.20	-0.94	-1.00	1.20	-0.77	1.31	0.28	-0.22	0.65
            0.32	-0.14	-0.26	-1.47	0.49	0.39	0.87	-0.10	-0.79	1.06
            0.37	-0.86	-1.47	-1.09	2.30	-0.80	0.88	-0.88	-0.20	1.70
        """
    }

    {
        name: "Sudoku"
        code: """
            #include <iostream>

            using namespace std;

            int const SIZE = 9;
            const int SUBSIZE = SIZE/3;

            int S[9][9];

            bool MR[9][9], MC[9][9], MQ[9][9], SET[9][9];

            bool found;

            int quad(const int i, const int j) {
                return (i/SUBSIZE)*SUBSIZE + j/SUBSIZE;
            }

            bool canPutNum(int num, int i, int j) {
                return not MC[j][num-1] and not MQ[quad(i, j)][num-1]
                       and not MR[i][num-1];
            }

            void putNum(int num, int i, int j) {
                S[i][j] = num;
                MR[i][num-1] = MC[j][num-1] = MQ[quad(i, j)][num-1] = true;
            }

            void removeNum(int num, int i, int j) {
                MR[i][num-1] = MC[j][num-1] = MQ[quad(i, j)][num-1] = false;
            }

            void backtrack(int i, int j) {
                if (not found) {
                    if (i < SIZE) {
                        if (not SET[i][j]) {
                            for (int num = 1; num <= SIZE; ++num) {
                                if (canPutNum(num, i, j)) {
                                    putNum(num, i, j);
                                    if (j + 1 == SIZE) backtrack(i + 1, 0);
                                    else backtrack(i, j + 1);
                                    if (not found) removeNum(num, i, j);
                        }	}	}
                        else {
                            if (j + 1 == SIZE) backtrack(i + 1, 0);
                            else backtrack(i, j + 1);
                    }	}
                    else found = true;
            }	}

            void initialize() {
                found = false;

                for (int i = 0; i < SIZE; ++i)
                    for (int j = 0; j < SIZE; ++j)
                        *(*(MR + i) + j) = (*(MC + i))[j] = MQ[i][j] = SET[i][j] = false;
            }

            void read() {
                for (int i = 0; i < SIZE; ++i) {
                    for (int j = 0; j < SIZE; ++j) {
                        char c; cin >> c;
                        if (c != '.') {
                            putNum(c - '0', i, j);
                            SET[i][j] = true;
            }	}	}	}

            void print() {
                cout << endl;
                for (int i = 0; i < SIZE; ++i) {
                    cout << S[i][0];
                    for (int j = 1; j < SIZE; ++j) cout << ' ' << S[i][j];
                    cout << endl;
            }	}

            void solve() {
                backtrack(0, 0);
            }

            int main() {
                int n; cin >> n; cout << n << endl;
                for (int i = 0; i < n; ++i) {
                    initialize();
                    read();
                    solve();
                    print();
            }	}
        """

        input: """
            2

            . . . . . 2 3 . 7
            . . . . . 6 4 5 .
            1 . . 9 3 . . . .
            . . . . 6 1 8 . .
            . 4 8 . . . 5 6 .
            . . 6 4 2 . . . .
            . . . . 7 5 . . 8
            . 2 9 1 . . . . .
            4 . 5 6 . . . . .

            7 . . . . 2 . . 4
            1 . . . . . 7 6 .
            2 . . . 8 . 3 . 9
            . . . 6 5 . 8 2 .
            . . . . 2 . . . .
            . 2 6 . 9 1 . . .
            8 . 7 . 1 . . . 5
            . 5 9 . . . . . 3
            3 . . 5 . . . . 8
        """
    }

    {
        name: "GCD"
        code: """
            // P67723_en: Greatest common divisor
            // Pre: two strictly positive natural numbers a and b
            // Post: the greatest common divisor of a and b

            #include<iostream>

            using namespace std;

            int main() {
                int a, b;
                cin >> a >> b;
                int a0 = a;     //we need to keep the value of the original a and b
                int b0 = b;

                while ( b != 0) {
                    int r = a%b;  //remainder
                    a = b;
                    b = r;
                }

                cout << "The gcd of " << a0 << " and " << b0 << " is " << a << "." << endl;
            }
        """

        input: "12 90"
    }

    {
        name: "Hanoi towers"
        code: """
            #include <iostream>
            using namespace std;

            void hanoi(int n, char from, char to, char aux) {
                if (n > 0) {
                    hanoi(n - 1, from, aux, to);
                    cout << from << " => " << to << endl;
                    hanoi(n - 1, aux, to, from);
                }
            }

            int main() {
                int ndiscos;
                cin >> ndiscos;
                hanoi(ndiscos, 'A', 'C', 'B');
            }
        """
        input: "3"
    }

    {
        name: "Rhombus"
        code: """
            #include <iostream>
            using namespace std;

            int main() {
                int x;
                cin >> x;
                for (int i = 1; i <= x; ++i) {
                    for (int j = 0; j < x + i - 1; ++j) {
                        if (j < x - i) cout << ' ';
                        else cout << '*';
                    }
                    cout << endl;
                }
                for (int i = 1; i < x; ++i) {
                    for (int j = 0; j < 2*x - i - 1; ++j) {
                        if (j >= i) cout << '*';
                        else cout << ' ';
                    }
                    cout << endl;
                }
            }
        """
        input: "10"
    }


]


MainCtrl = ($scope, $state, $window, $mdMedia, $rootScope, $mdToast, $timeout) ->
    #####
    # SCOPE VARIABLES INITIALIZATION
    #####

    STATUS = {
        WAITING_INPUT: {
            icon: 'input'
            tooltip: "Waiting for input"
            color: "white"
            text: "Waiting for input"
        }
        RUNNING: {
            icon: 'directions_run'
            tooltip: "Running"
            color: "white"
            text: "Running"
        }
        PAUSED: {
            icon: "pause"
            tooltip: "Paused"
            color: "white"
            text: ""
        }
    }

    initialExample = 0

    $scope.selectedIndex = 0 # For the tabs

    $scope.speed = 0.4;

    $scope.astString = ""
    $scope.instructionsString = ""
    $scope.compilerHelpString = ""
    $scope.fixedInput = EXAMPLES[initialExample].input ? ""

    $scope.compiled = no
    $scope.compileError = no
    $scope.running = no
    $scope.debugging = no
    $scope.runningStatus = no

    $scope.variables = {}

    $scope.$mdMedia = $mdMedia


    $scope.$watch('runningStatus', _.debounce(( (newv, oldv) ->
        icon = $('.status i')
        times = if newv is oldv then 2 else 3

        icon.delay(100).fadeTo(100,0.5).delay(100).fadeTo(100,1) for time in [0...times]
    ), 50))

    #####
    # RESPONSIVE
    #####

    $rootScope.$on('$stateChangeStart', (event, toState, toParams, fromState, fromParams) ->
        if toState.name isnt "terminal"
            $("#terminal").appendTo(".terminalOuter")
            $.terminal.active()?.scroll_to_bottom()
    )

    $rootScope.$on('$viewContentLoaded', (event, toState, toParams, fromState, fromParams) ->
        if $state.current.name is "terminal"
            $("#terminal").appendTo("#terminalTab")
            $.terminal.active()?.scroll_to_bottom()
    )

    $scope.$watch((-> $mdMedia('gt-sm')), (big) ->
        if big
            $state.go('fixed-input')
            if $scope.tabs.some((e) -> e.title is 'Terminal')
                $scope.tabs.shift()
                $("#terminal").appendTo(".terminalOuter")
        else unless $scope.tabs.some((e) -> e.title is 'Terminal')
            $state.go('terminal')
            $scope.tabs.unshift { isTerminal: yes, icon: 'tv', title: 'Terminal', state: 'terminal', showCondition: -> yes }
    )


    #####
    # EDITOR SETUP
    #####

    editor = ace.edit("editor")
    editor.setTheme("ace/theme/twilight");
    editor.getSession().setMode("ace/mode/c_cpp")
    editor.$blockScrolling = Infinity
    editor.setValue(EXAMPLES[initialExample].code, -1)
    aceRange = ace.require('ace/range').Range;

    getBreakpoints = -> Object.keys(editor.session.getBreakpoints(undefined, 0)).map((x) -> parseInt(x) + 1)

    editor.on("guttermousedown", (e) ->
        target = e.domEvent.target
        if target.className.indexOf("ace_gutter-cell") == -1
            return
        if !editor.isFocused()
            editor.focus()
        if e.clientX > 25 + target.getBoundingClientRect().left
            return

        { row } = e.getDocumentPosition()

        breakpoints = e.editor.session.getBreakpoints(row, 0)
        if row not of breakpoints
            e.editor.session.setBreakpoint(row)
            #range = new aceRange(row, 0, row, 1);
            #markedLines[row] = e.editor.session.addMarker(range, "warning", "fullLine", true);
            worker.postMessage({ command: "addBreakpoint", breakpoint: row + 1 })
        else
            e.editor.session.clearBreakpoint(row)
            #editor.getSession().removeMarker markedLines[row]
            #delete markedLines[row]
            worker.postMessage({ command: "removeBreakpoint", breakpoint: row + 1 })
        e.stop()
    )



    #####
    # TERMINAL SETUP
    #####

    jQuery ($) ->
        $('#terminal').terminal ((command) ->
            if command in ["compile", "c"]
                $scope.compile(yes)
            else if command in ["run", "r"]
                $scope.run(yes)
            else if command in ["debug", "d"]
                $scope.debug(yes)
            else
                this.error("Invalid command #{command}. Type 'compile', 'run' or 'debug'")
        ),
            greetings: "This is the C-- terminal. Type 'compile', 'run' or 'debug'"
            name: 'js_demo'
            height: 200
            prompt: '> '
            completion: ['compile', 'run', 'debug', 'c', 'r', 'd']
            scrollOnEcho: yes
            keymap: {
                "CTRL+D": -> worker.postMessage({ command: "endOfInput" })
                "CTRL+Z": ->
                    $scope.kill()
                    $scope.$apply()
                "CTRL+C": ->
                    $scope.kill()
                    $scope.$apply()
            }


    #####
    # WORKER SETUP
    #####

    worker = null
    output = null
    currentLine = null
    listen = {}

    terminal = -> $.terminal.active()

    echo = (msg) ->
        terminal().echo(if msg.length is 0 then "\0" else msg)

    listen.output = ({ string }) ->
        term = terminal()
        lines = string.split('\n')
        if lines.length is 1
            term.set_prompt(output = term.get_prompt() + lines[0])
        else
            echo((output ? "") + lines[0])
            for line in lines[1...-1]
                echo(line)

            term.set_prompt(output = lines[lines.length - 1])

    listen.compilationError = ({ message, description }) ->
        $scope.compileError = yes
        $scope.compiled = yes

        $scope.compilerHelpString = description ? ""

        term = terminal()
        term.error message

    listen.startRunning = ->
        #console.log "startRunning"
        $scope.running = yes
        $scope.runningStatus = STATUS.RUNNING
        unless $mdMedia('gt-sm')
            setTimeout((->$state.go('terminal'); $scope.selectedIndex = 0), 100)

        $.terminal.active().push((command) ->
            output = null
            this.set_prompt("")
            worker.postMessage({ command: "input", input: command })
        ,
            name: 'runEnvironment'
            prompt: ''
        )

    listen.startDebugging = ->
        $scope.debugging = yes

        listen.startRunning()

        # TODO: Go to debugging tab when implemented

    listen.currentLine = ({ line }) ->
        editor.getSession().removeMarker currentLine if currentLine?
        row = line - 1
        range = new aceRange(row, 0, row, 1);
        currentLine = editor.getSession().addMarker(range, "current-line", "fullLine", true)

    listen.compilationSuccessful = ({ ast, instructions }) ->
        $scope.compiled = yes
        $scope.compileError = no

        $scope.astString = ast

        $scope.instructionsString = instructions

    listen.executionFinish = ({ status }) ->
        # TODO: Show status somehow

        if $scope.debugging
            $state.go('fixed-input')
            $scope.selectedIndex = 0

        term = terminal()
        term.echo(output) if output?
        term.pop()
        $scope.running = $scope.debugging = no
        $scope.waitingForInput = no
        $scope.runningStatus = no
        output = null
        editor.getSession().removeMarker currentLine if currentLine?
        currentLine = null

    listen.resumeRunning = ->
        #console.log "resume"
        if $scope.debugging
            $timeout((-> # Prevents continuous flashing when using step over/step
                if $scope.runningStatus is STATUS.RUNNING
                    $state.go('fixed-input'); $scope.selectedIndex = 0
            ), 100)

        $scope.runningStatus = STATUS.RUNNING

    listen.waitingForInput = ->
        $scope.runningStatus = STATUS.WAITING_INPUT

    listen.paused = ({ variables }) ->
        $scope.variables = variables
        $scope.runningStatus = STATUS.PAUSED

    listen.variableSet = ({ id, value, repr }) ->
        $scope.variables[id].value = value
        $scope.variables[id].repr = repr
        $scope.variables[id].edit = no

    listen.invalidVariableValue = ({ id, value }) ->
        showToast "Invalid value '#{value}' for variable with type #{$scope.variables[id].type}"



    do resetWorker = ->
        worker = new Worker("/worker.js")

        worker.onmessage = (e) ->
            { data: { event, data }} = e

            unless listen[event]?
                throw "Invalid event #{event}"
            else
                listen[event](data)

            $scope.$apply()

        for breakpoint in getBreakpoints()
            worker.postMessage({ command: "addBreakpoint", breakpoint })

    #####
    # ACTIONS
    #####

    $scope.selectExample = (example) ->
        editor.setValue(example.code, -1)
        $scope.fixedInput = example.input ? ""

    $scope.debug = (fromTerminal) ->
        unless fromTerminal
            $.terminal.active().echo("> debug")

        output = null
        worker.postMessage({ command: "debug", code: editor.getValue(), input: $scope.fixedInput })

        null

    $scope.run = (fromTerminal) ->
        unless fromTerminal
            $.terminal.active().echo("> run")

        output = null
        worker.postMessage({ command: "run", code: editor.getValue(), input: $scope.fixedInput })

        null

    $scope.continue = -> worker.postMessage({ command: "continue" })

    $scope.kill = ->
        listen.executionFinish({ status: null })
        worker.terminate()
        resetWorker()

    $scope.compile = (fromTerminal) ->
        unless fromTerminal
            $.terminal.active().echo("> compile")

        worker.postMessage({ command: "compile", code: editor.getValue() })

    $scope.stepOver = -> worker.postMessage({ command: "stepOver" })

    $scope.stepInto = -> worker.postMessage({ command: "stepInto" })

    $scope.stepOut = -> worker.postMessage({ command: "stepOut" })

    $scope.stepInstruction = -> worker.postMessage({ command: "stepInstruction" })

    showToast = (text) ->
        toast = $mdToast.simple()
            .textContent(text)
            .position('top right')
            .hideDelay(3000);
        $mdToast.show toast

    $scope.tryToEdit = (variable, name) ->
        if variable.const
            showToast "Cannot set value for #{name}: it's declared const"
        else if variable.isArray
            showToast "Changing array values is not supported yet"
        else
            variable.edit = yes
            variable.editValue =
                if variable.isChar # Null char values can mess up (no way to tell whether there's something)
                    ''
                else
                    variable.value

    $scope.confirmVariableEdit = (variable, name) ->
        { editValue: value } = variable

        worker.postMessage({ command: "setVariable", id: name, value })

    $scope.cancelVariableEdit = (variable) ->
        variable.editValue = null
        variable.edit = no

    #####
    # CONTENT
    #####


    $scope.examples = EXAMPLES

    $scope.tabs = [
        {
            icon: 'input'
            title: 'Fixed input'
            state: 'fixed-input'
            showCondition: -> yes
        }


        #{
        #    icon: 'bug_report'
        #    title: 'Variables'
        #    state: 'variables'
        #    showCondition: -> $scope.debugging
        #}


        {
            icon: 'build'
            title: 'Compilation Help'
            state: 'compilation-help'
            showCondition: -> $scope.compiled and $scope.compileError and $scope.compilerHelpString.length > 0
        }
        {
            icon: 'code'
            title: 'AST'
            state: 'ast'
            showCondition: -> $scope.compiled and not $scope.compileError
        }
        {
            icon: 'format_list_numbered'
            title: 'Instructions'
            state: 'instructions'
            showCondition: -> $scope.compiled and not $scope.compileError
        }

        {
            icon: "bug_report"
            title: 'Variables'
            state: 'variables'
            showCondition: -> $scope.debugging and $scope.runningStatus is STATUS.PAUSED
        }
    ]

    $scope.buttons = [
        {
            text: "Compile"
            icon: "build"
            tooltip: "Compiles the program"
            color: '#7986CB'
            action: $scope.compile
            showCondition: -> not $scope.running
        }

        {
            text: "Run"
            icon: "play_arrow"
            tooltip: "Compiles and runs the program"
            color: '#009688'
            action: $scope.run

            showCondition: -> not $scope.running
        }

        {
            text: "Kill"
            icon: "stop"
            tooltip: "Kills the program"
            color: "#EF5350"

            action: $scope.kill
            showCondition: -> $scope.running
        }

        {
            text: "Debug"
            icon: "bug_report"
            tooltip: "Compiles and starts debugging"
            color: '#EF6C00'
            action: $scope.debug
            showCondition: -> not $scope.running
        }

        {
            text: "Continue"
            icon: "play_arrow"
            tooltip: "Continues debugging the program"
            color: '#009688'
            action: $scope.continue
            showCondition: -> $scope.debugging and $scope.runningStatus is STATUS.PAUSED
        }

        {
            text: "Step over"
            icon: "vertical_align_bottom"
            tooltip: "Runs the program until the next line of code"
            color: '#689F38'
            action: $scope.stepOver
            showCondition: -> $scope.debugging and $scope.runningStatus is STATUS.PAUSED
        }

        {
            text: "Step into"
            icon: "subdirectory_arrow_right"
            tooltip: "Enters the function call or steps over"
            color: '#558B2F'
            action: $scope.stepInto
            showCondition: -> $scope.debugging and $scope.runningStatus is STATUS.PAUSED
        }

        {
            text: "Step out"
            icon: "reply"
            tooltip: "Runs the program until the current function returns"
            color: '#33691E'
            action: $scope.stepOut
            showCondition: -> $scope.debugging and $scope.runningStatus is STATUS.PAUSED
        }

        {
            text: "Step"
            icon: "keyboard_arrow_down"
            tooltip: "Runs the program until the next instruction"
            color: "#827717"
            action: $scope.stepInstruction
            showCondition: -> $scope.debugging and $scope.runningStatus is STATUS.PAUSED
        }

    ]


app.controller('MainCtrl', ['$scope', '$state', '$window', '$mdMedia', '$rootScope', '$mdToast', '$timeout', MainCtrl])
