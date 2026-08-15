import os

from neo4j import GraphDatabase


class Neo4jClient:

    def __init__(self):

        self.driver = (
            GraphDatabase.driver(
                os.getenv("NEO4J_URI", "bolt://localhost:7687"),
                auth=(
                    os.getenv("NEO4J_USER", "neo4j"),
                    os.getenv("NEO4J_PASSWORD", "password"),
                )
            )
        )

    def execute(
        self,
        query,
        params=None
    ):

        with self.driver.session() as session:

            session.run(
                query,
                params or {}
            )
