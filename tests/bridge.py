# Stands in for Pyodide: runs the real engine.py and returns what app.js would get back.
import sys, os, json, importlib.util
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("engine", os.path.join(os.environ.get("APP_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."), "engine.py"))
engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)
name = sys.argv[1]
args = json.loads(sys.argv[2])
try:
    result = getattr(engine, name)(*args)
except Exception as err:
    sys.stderr.write("Traceback (most recent call last):\n  File \"<exec>\", line 1\n" + type(err).__name__ + ": " + str(err) + "\n")
    sys.exit(1)
sys.stdout.write(result)
