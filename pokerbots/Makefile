.PHONY: all quick test tables
all:
	./run_all.sh
quick:
	QUICK=1 ./run_all.sh
test:
	python3 -m unittest discover -s engine/tests -t .
	python3 -m unittest discover -s bots/tests -t .
tables:
	python3 -m report.make_tables
